//! The second-order test at a stationary drag point. Along a direction `d` of the lasting rows'
//! null space, the squared target distance changes to second order by `d^T H d`, with
//! `H = E^T E + sum lambda_i Hess c_i` and the multipliers `J^T lambda = -E^T r`. A point whose
//! smallest such curvature is not clearly negative meets the first- and second-order necessary
//! conditions on its branch; a clearly negative one gives the direction that gets closer, as a
//! straight arm folding toward a target inside its reach or a point leaving a circle's far side.
//!
//! `H` is nonzero only on the support `S`: the targeted columns and those of the nonlinear rows
//! carrying a multiplier. The least-norm direction of the null space with a given part on `S` is
//! orthogonal to every direction that leaves `S` still, so the curvature over the null space is
//! the generalized eigenproblem of `H_SS` against `P_SS`, `P` the projector onto the null space.
//! Both come from one factor of `J^T`.

use super::{Drag, W, norm, row_length};
use crate::dense::symmetric_eigen;
use crate::dual::{Dual, WIDTH};
use crate::equations::residual;
use crate::newton::Exhausted;
use crate::sparse::{Factor, minimum_degree};

/// Most columns of the support; a wider one is not certified.
const SUPPORT: usize = 64;
/// Most refinements of the multipliers.
const REFINEMENTS: usize = 8;

pub(super) enum Curvature {
    /// No direction along the lasting rows gets closer to second order.
    Certified,
    /// The most negative curvature `theta` of the squared distance's half along the unit
    /// direction `direction`, by column.
    Negative { direction: Vec<f64>, theta: f64 },
    /// The lowest curvature is within its error of zero along `direction`, so higher orders decide.
    Flat { direction: Vec<f64> },
    /// The multipliers or the support could not be resolved, or a curved row has collapsed.
    Unresolved,
}

/// One nonlinear row's weighted Hessian over its columns, with its multiplier and error scale.
struct Curved { columns: Vec<usize>, hessian: Vec<Vec<f64>>, lambda: f64, size: f64, error: f64 }

impl Drag<'_> {
    pub(super) fn curvature(&mut self, values: &[f64], r: &[f64]) -> Result<Curvature, Exhausted> {
        let rows = self.lasting.rows(values, None);
        let (n, m) = (self.position.len(), rows.len());
        // The objective's gradient `E^T r`, by column.
        let mut g = vec![0.0; n];
        for (target, &r) in self.targets.iter().zip(r) { g[target.column] += r; }
        if m == 0 { return Ok(Curvature::Certified); }
        // `J` by column, over equations.
        let mut columns: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
        for (i, row) in rows.iter().enumerate() {
            for k in 0..row.len { if row.derivatives[k] != 0.0 { columns[row.columns[k]].push((i, row.derivatives[k])); } }
        }
        let structure: Vec<Vec<usize>> = columns.iter().map(|column| column.iter().map(|&(i, _)| i).collect()).collect();
        let Some(ordering) = minimum_degree(m, &structure, self.limits.fill, self.limits.work.saturating_sub(self.work))
            else { return Ok(Curvature::Unresolved); };
        self.work = self.work.saturating_add(ordering.work);
        let place = ordering.position;
        let by_place = |column: &[(usize, f64)]| {
            let mut row: Vec<(usize, f64)> = column.iter().map(|&(i, v)| (place[i], v)).collect();
            // A column meets few rows, so insertion sort.
            for i in 1..row.len() {
                let mut j = i;
                while j > 0 && row[j - 1].0 > row[j].0 { row.swap(j - 1, j); j -= 1; }
            }
            row
        };
        // `R^T R = J J^T + W^-2 I`: the damping matches the null space `stationary` projects onto.
        let factor = Factor::damped(m, 1.0 / (W * W), self.limits.work.saturating_sub(self.work));
        let factor = self.rotate(factor, columns.iter().zip(&g).map(|(column, &g)| (by_place(column), -g)))?;
        let Some(mut by_position) = factor.solve() else { return Ok(Curvature::Unresolved); };
        // The damping leaves the multipliers off by `rho = W^-2 / (sigma^2 + W^-2)` of their part
        // along each direction of `J^T` with singular value `sigma`. Corrected seminormal steps,
        // `R^T R delta = -J k` for the remainder `k`, shrink that part by `rho` each, so successive
        // steps estimate the slowest `rho` and their geometric tail bounds what is left. Where `J^T`
        // is too weak for the steps to shrink by half, the multipliers are not known.
        let remainder = |by_position: &[f64]| -> Vec<f64> { columns.iter().zip(&g).map(|(column, &g)| g + column.iter().map(|&(i, v)| v * by_position[place[i]]).sum::<f64>()).collect() };
        let mut kkt = remainder(&by_position);
        let (mut before, mut error) = (f64::INFINITY, f64::INFINITY);
        for _ in 0..REFINEMENTS {
            let mut jk = vec![0.0; m];
            for (column, &k) in columns.iter().zip(&kkt) { for &(i, v) in column { jk[place[i]] -= v * k; } }
            let Some(delta) = factor.solve_transposed(&jk).and_then(|y| factor.solve_with(&y)) else { return Ok(Curvature::Unresolved); };
            for (lambda, delta) in by_position.iter_mut().zip(&delta) { *lambda += delta; }
            kkt = remainder(&by_position);
            let step = norm(&delta);
            // Converged to the multipliers' own roundoff.
            if step <= 64.0 * f64::EPSILON * norm(&by_position) { error = step; break; }
            let ratio = step / before;
            error = if ratio < 0.5 { step * ratio / (1.0 - ratio) } else { f64::INFINITY };
            before = step;
        }
        // The multipliers explain the gradient up to its certified projected part.
        if !(error.is_finite() && norm(&kkt) <= 2.0 * self.stationary) { return Ok(Curvature::Unresolved); }
        let lambda: Vec<f64> = (0..m).map(|i| by_position[place[i]]).collect();

        let negligible = error + 64.0 * f64::EPSILON * norm(&g);
        let Some(curved) = self.curved(values, &rows, &lambda, negligible) else { return Ok(Curvature::Unresolved); };
        let total: f64 = curved.iter().map(|row| row.lambda.abs() * row.size).sum();
        // What the curvature is known to: each row's differencing error, the multipliers' error
        // against every row's curvature, and roundoff in the eigensolves.
        let tolerance = curved.iter().map(|row| row.lambda.abs() * row.size * row.error).sum::<f64>()
            + error * curved.iter().map(|row| row.size).sum::<f64>()
            + 64.0 * f64::EPSILON * (1.0 + total) * (self.targets.len() + curved.iter().map(|row| row.columns.len()).sum::<usize>()) as f64;
        // Rows each within an even share of half the tolerance are left out, so together they stay within it.
        let share = 0.5 * tolerance / curved.len().max(1) as f64;
        let curved: Vec<&Curved> = curved.iter().filter(|row| row.lambda.abs() * row.size > share).collect();
        // Only linear rows carry the multipliers: the point is nearest over the affine set those rows
        // define, which holds the whole feasible set, so it is nearest over that too.
        if curved.is_empty() { return Ok(Curvature::Certified); }

        // The support's columns in first-seen order, and each column's place in it.
        let (mut support, mut at) = (Vec::new(), vec![usize::MAX; n]);
        for &column in self.targets.iter().map(|target| &target.column).chain(curved.iter().flat_map(|row| &row.columns)) {
            if at[column] == usize::MAX { at[column] = support.len(); support.push(column); }
        }
        if support.len() > SUPPORT { return Ok(Curvature::Unresolved); }
        let s = support.len();
        let index = |column: usize| (at[column] != usize::MAX).then_some(at[column]);
        let mut hessian = vec![vec![0.0; s]; s];
        for target in self.targets { let k = index(target.column).unwrap(); hessian[k][k] += 1.0; }
        for row in &curved {
            for (a, &ca) in row.columns.iter().enumerate() {
                for (b, &cb) in row.columns.iter().enumerate() { hessian[index(ca).unwrap()][index(cb).unwrap()] += row.lambda * row.hessian[a][b]; }
            }
        }
        // `X = R^-T J_S`, so `P_SS = I - X^T X`.
        let mut x: Vec<Vec<f64>> = Vec::with_capacity(s);
        for &column in &support {
            let mut b = vec![0.0; m];
            for &(i, v) in &columns[column] { b[place[i]] = v; }
            let Some(y) = factor.solve_transposed(&b) else { return Ok(Curvature::Unresolved); };
            x.push(y);
        }
        let dot = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>();
        let projector: Vec<Vec<f64>> = (0..s).map(|a| (0..s).map(|b| if a == b { 1.0 } else { 0.0 } - dot(&x[a], &x[b])).collect()).collect();
        let (spread, basis) = symmetric_eigen(projector);
        let floor = 64.0 * f64::EPSILON * s as f64;
        let kept: Vec<usize> = (0..s).filter(|&k| spread[k] > floor).collect();
        // Nothing along the lasting rows moves the support, to roundoff: the targets and every
        // curved row are held.
        if kept.is_empty() { return Ok(Curvature::Certified); }
        // The damped projector `P = I - J^T (J J^T + W^-2)^-1 J` also passes a held direction's leak,
        // `rho` of it, which no cutoff on `P_SS` separates from slight real motion. `P` keeps a null
        // direction whole and scales a leak by `rho`, so the pencil `(P^2)_SS a = mu P_SS a` tells them
        // apart: `mu = 1` moves, `mu = rho` leaks. Directions with `mu > 1/2` are kept, so a weak
        // holding row counts as motion, never the reverse.
        let mut lifted: Vec<Vec<f64>> = Vec::with_capacity(s);
        for (&column, y) in support.iter().zip(&x) {
            let Some(w) = factor.solve_with(y) else { return Ok(Curvature::Unresolved); };
            let mut p = vec![0.0; n];
            p[column] = 1.0;
            for (c, entries) in columns.iter().enumerate() { p[c] -= entries.iter().map(|&(i, v)| v * w[place[i]]).sum::<f64>(); }
            lifted.push(p);
        }
        let square: Vec<Vec<f64>> = (0..s).map(|a| (0..s).map(|b| dot(&lifted[a], &lifted[b])).collect()).collect();
        let along = |vector: &[f64], matrix: &[Vec<f64>], other: &[f64]| (0..s).map(|a| vector[a] * dot(&matrix[a], other)).sum::<f64>();
        let pencil: Vec<Vec<f64>> = kept.iter().map(|&j| kept.iter().map(|&l| along(&basis[j], &square, &basis[l]) / (spread[j] * spread[l]).sqrt()).collect()).collect();
        let (moving, mixes) = symmetric_eigen(pencil);
        let moves: Vec<&Vec<f64>> = (0..kept.len()).filter(|&k| moving[k] > 0.5).map(|k| &mixes[k]).collect();
        if moves.is_empty() { return Ok(Curvature::Certified); }
        // In coordinates `b` with `d_S = U Lambda^1/2 b`, `|d| = |b|` and the curvature is
        // `b^T C^T H_SS C b` for `C = U Lambda^1/2`; over the moving mixes `z`, `b = Z w`.
        let c: Vec<Vec<f64>> = kept.iter().map(|&k| basis[k].iter().map(|u| u * spread[k].sqrt()).collect()).collect();
        let mixed: Vec<Vec<f64>> = moves.iter().map(|z| (0..s).map(|a| z.iter().zip(&c).map(|(z, c)| z * c[a]).sum::<f64>()).collect()).collect();
        let reduced: Vec<Vec<f64>> = mixed.iter().map(|ma| mixed.iter().map(|mb| (0..s).map(|a| ma[a] * dot(&hessian[a], mb)).sum::<f64>()).collect()).collect();
        let (curvatures, directions) = symmetric_eigen(reduced);
        let (lowest, &theta) = curvatures.iter().enumerate().min_by(|a, b| a.1.total_cmp(b.1)).unwrap();
        if theta > tolerance { return Ok(Curvature::Certified); }
        // Lifted to the least-norm direction of the null space: `d = a - J^T R^-1 X a` for
        // `a = U Lambda^-1/2 b` on the support, `b = Z w`.
        let mut b = vec![0.0; kept.len()];
        for (z, &w) in moves.iter().zip(&directions[lowest]) { for (b, z) in b.iter_mut().zip(z.iter()) { *b += w * z; } }
        let mut a = vec![0.0; s];
        for (&k, &b) in kept.iter().zip(&b) { for (a, u) in a.iter_mut().zip(&basis[k]) { *a += b * u / spread[k].sqrt(); } }
        let mut xa = vec![0.0; m];
        for (y, &a) in x.iter().zip(&a) { for (xa, y) in xa.iter_mut().zip(y) { *xa += a * y; } }
        let Some(w) = factor.solve_with(&xa) else { return Ok(Curvature::Unresolved); };
        let mut d = vec![0.0; n];
        for (&column, &a) in support.iter().zip(&a) { d[column] = a; }
        for (column, entries) in columns.iter().enumerate() { d[column] -= entries.iter().map(|&(i, v)| v * w[place[i]]).sum::<f64>(); }
        // One projection removes what roundoff left across the lasting rows.
        let jacobian = self.jacobian(values);
        let Some((d, _)) = self.project(&jacobian, &d)? else { return Ok(Curvature::Unresolved); };
        let length = norm(&d);
        if !(length > 0.0 && length.is_finite()) { return Ok(Curvature::Unresolved); }
        let direction = d.iter().map(|value| value / length).collect();
        Ok(if theta < -tolerance { Curvature::Negative { direction, theta } } else { Curvature::Flat { direction } })
    }

    /// The nonlinear rows with a nonzero multiplier and their Hessians, by central differences of
    /// the exact gradient with each row's weight held. The step balances truncation, about
    /// `delta^2 / L^2` relative for a row of length `L`, against coordinate roundoff,
    /// `epsilon S / delta`. `None` when a row whose multiplier is not `negligible`, within its own
    /// error, has collapsed to a length its coordinates cannot resolve: a zero distance has no
    /// gradient to expand along, so neither order of the test describes it.
    fn curved(&self, values: &[f64], rows: &[crate::newton::Row], lambda: &[f64], negligible: f64) -> Option<Vec<Curved>> {
        let problem = self.lasting.problem;
        let mut curved = Vec::new();
        for ((&e, row), &lambda) in self.lasting.equations.iter().zip(rows).zip(lambda) {
            if lambda == 0.0 || row.len == 0 { continue; }
            let equation = &problem.equations[e];
            let operands: Vec<f64> = equation.operands.iter().map(|&p| values[p]).collect();
            let free: Vec<bool> = equation.operands.iter().map(|&p| self.lasting.column[p] != usize::MAX).collect();
            let Some(length) = row_length(equation.kind, &operands, &free) else { continue; };
            if !(length > 64.0 * f64::EPSILON * row.scale) {
                if lambda.abs() > negligible { return None; }
                continue;
            }
            let columns: Vec<usize> = row.columns[..row.len].to_vec();
            let gradient = |operands: &[f64]| {
                let duals: Vec<Dual> = operands.iter().enumerate().map(|(slot, &value)| Dual::variable(value, slot)).collect();
                let result = residual(equation.kind, &duals, equation.value);
                let mut by_column = vec![0.0; columns.len()];
                for (slot, &p) in equation.operands.iter().enumerate() {
                    if let Some(k) = columns.iter().position(|&c| c == self.lasting.column[p]) { by_column[k] += row.weight * result.gradient[slot]; }
                }
                by_column
            };
            let delta = (f64::EPSILON * row.scale * length * length).cbrt();
            let mut hessian = vec![vec![0.0; columns.len()]; columns.len()];
            for (k, &column) in columns.iter().enumerate() {
                let p = self.lasting.unknowns[column];
                let shifted = |sign: f64| -> Vec<f64> { equation.operands.iter().zip(&operands).map(|(&q, &value)| if q == p { value + sign * delta } else { value }).collect() };
                let (plus, minus) = (shifted(1.0), shifted(-1.0));
                let slot = equation.operands.iter().position(|&q| q == p).unwrap();
                let step = plus[slot] - minus[slot];
                let (upper, lower) = (gradient(&plus), gradient(&minus));
                for a in 0..columns.len() { hessian[a][k] = (upper[a] - lower[a]) / step; }
            }
            for a in 0..columns.len() {
                for b in 0..a { let mean = 0.5 * (hessian[a][b] + hessian[b][a]); hessian[a][b] = mean; hessian[b][a] = mean; }
            }
            let size = hessian.iter().flatten().map(|h| h * h).sum::<f64>().sqrt();
            debug_assert!(columns.len() <= WIDTH);
            curved.push(Curved { columns, hessian, lambda, size, error: 4.0 * (f64::EPSILON * row.scale / length).powf(2.0 / 3.0) });
        }
        Some(curved)
    }
}
