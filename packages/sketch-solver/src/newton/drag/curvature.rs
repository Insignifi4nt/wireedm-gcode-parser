//! The second-order test at a stationary drag point. Along a direction `d` of the lasting rows'
//! null space, the squared target distance changes to second order by `d^T H d`, with
//! `H = E^T E + sum lambda_i Hess c_i` and the multipliers `J^T lambda = -E^T r`. A point whose
//! smallest such curvature is not clearly negative meets the first- and second-order necessary
//! conditions on its branch, up to the test's resolution; a clearly negative one gives the direction that gets closer, as a
//! straight arm folding toward a target inside its reach or a point leaving a circle's far side.
//!
//! `H` is nonzero only on the support `S`: the targeted columns and those of the nonlinear rows
//! carrying a multiplier. The sign of `d^T H d` over the null space is that of `H_SS` over the
//! support's part of the null space, whose basis comes from the singular vectors of the projector's
//! columns on `S`; the curvature is measured per unit of support motion.
//!
//! Every decision carries a verified roundoff bound. The factor of `J^T` is damped at the Jacobian's own
//! roundoff, and a bound on its inverse from the comparison matrix, or a verified Frobenius norm,
//! bounds the smallest singular value from below. That bounds each curved row's multiplier error
//! and each projector column's error; a share of support motion between twice and eight times its
//! error, or a factor too ill-conditioned to bound, leaves the test unresolved. Two limits remain:
//! a share within twice its error counts as held, and a curved row whose multiplier is within its
//! error and the first-order tolerance of zero counts as carrying none.

use super::{Drag, norm, row_length};
use crate::dense::{singular, symmetric_eigen};
use crate::dual::{Dual, WIDTH};
use crate::equations::residual;
use crate::newton::Exhausted;
use crate::sparse::{Factor, minimum_degree};

/// Most columns of the support; a wider one leaves the test unresolved.
const SUPPORT: usize = 64;
/// Refinements of the multipliers; soundness rests on the error bounds, not on these.
const REFINEMENTS: usize = 2;

/// `gamma_k = k epsilon / (1 - k epsilon)`, the relative error of `k` rounded operations.
fn gamma(k: usize) -> f64 { let e = k as f64 * f64::EPSILON; e / (1.0 - e) }

/// `|R^-1|_F` by solving `R^T y = e_i` from position `i` on, as the inverse's columns are zero
/// before their own position; `None` past `allowance` entries. Also the entries spent.
fn frobenius(factor: &Factor, positions: &[usize], m: usize, allowance: usize) -> (Option<f64>, usize) {
    let (mut total, mut spent, mut y) = (0.0, 0, vec![0.0; m]);
    for &i in positions {
        y[i..].fill(0.0);
        y[i] = 1.0;
        for k in i..m {
            if y[k] == 0.0 { continue; }
            let row = &factor.rows[k];
            y[k] /= row[0].1;
            let value = y[k];
            for &(j, entry) in &row[1..] { y[j] -= entry * value; }
            spent += row.len();
        }
        total += y[i..].iter().map(|v| v * v).sum::<f64>();
        if spent > allowance { return (None, spent); }
    }
    (total.is_finite().then_some(total.sqrt()), spent)
}

pub(super) enum Curvature {
    /// No resolved direction along the lasting rows gets closer to second order.
    Clear,
    /// The most negative curvature `theta` of the squared distance's half along the unit
    /// direction `direction`, by column.
    Negative { direction: Vec<f64>, theta: f64 },
    /// The lowest curvature is within its error of zero along `direction`, so higher orders decide;
    /// `still` when that direction moves no target, within its error.
    Flat { direction: Vec<f64>, still: bool },
    /// The multipliers or the support could not be resolved, or a curved row has collapsed.
    Unresolved,
}

/// One nonlinear row's weighted Hessian over its columns, with its multiplier and error scale, its
/// place among the rows and its multiplier's error.
struct Curved { columns: Vec<usize>, hessian: Vec<Vec<f64>>, lambda: f64, size: f64, error: f64, index: usize, uncertainty: f64, spread: f64 }

impl Drag<'_> {
    pub(super) fn curvature(&mut self, values: &[f64], r: &[f64]) -> Result<Curvature, Exhausted> {
        let rows = self.lasting.rows(values, None);
        let (n, m) = (self.position.len(), rows.len());
        // The objective's gradient `E^T r`, by column.
        let mut g = vec![0.0; n];
        for (target, &r) in self.targets.iter().zip(r) { g[target.column] += r; }
        if m == 0 { return Ok(Curvature::Clear); }
        // The test is of a relaxation: rows left out only widen the null space it covers, with the
        // same multipliers, so a test resolving nothing closer without them resolves nothing with them. A collapsed distance, which has no
        // gradient to expand along, is left out, and so is a row the factor finds dependent.
        let mut kept: Vec<bool> = self.lasting.equations.iter().zip(&rows).map(|(&e, row)| !self.collapsed(values, e, row)).collect();
        // `J` by column, over equations.
        let mut columns: Vec<Vec<(usize, f64)>> = vec![Vec::new(); n];
        for (i, row) in rows.iter().enumerate() {
            for k in 0..row.len { if row.derivatives[k] != 0.0 { columns[row.columns[k]].push((i, row.derivatives[k])); } }
        }
        let size_j = columns.iter().flatten().map(|&(_, v)| v * v).sum::<f64>().sqrt();
        if !(size_j > 0.0 && size_j.is_finite()) { return Ok(Curvature::Unresolved); }
        let structure: Vec<Vec<usize>> = columns.iter().map(|column| column.iter().map(|&(i, _)| i).collect()).collect();
        let Some(ordering) = minimum_degree(m, &structure, self.limits.fill, self.limits.work.saturating_sub(self.work))
            else { return Ok(Curvature::Unresolved); };
        self.work = self.work.saturating_add(ordering.work);
        let place = ordering.position;
        // Damping at the Jacobian's own roundoff, so that a held direction leaks nothing that
        // slight real motion could be mistaken for.
        let mu = (64.0 * f64::EPSILON * size_j).powi(2);
        let mut factored = None;
        for _ in 0..2 {
            let factor = Factor::damped(m, mu, self.limits.work.saturating_sub(self.work));
            let entries: Vec<(Vec<(usize, f64)>, f64)> = columns.iter().zip(&g).map(|(column, &g)| {
                let mut row: Vec<(usize, f64)> = column.iter().filter(|&&(i, _)| kept[i]).map(|&(i, v)| (place[i], v)).collect();
                // A column meets few rows, so insertion sort.
                for i in 1..row.len() {
                    let mut j = i;
                    while j > 0 && row[j - 1].0 > row[j].0 { row.swap(j - 1, j); j -= 1; }
                }
                (row, -g)
            }).collect();
            let factor = self.rotate(factor, entries)?;
            // `R^T R = J J^T + mu I + G`, with `|G| <= eta` from the rotations' backward error and
            // the Jacobian's own evaluation error.
            let backward = gamma(4 * factor.depth + 8) * size_j;
            let eta = mu + 2.0 * backward * size_j + backward * backward;
            let dependent: Vec<usize> = (0..m).filter(|&i| kept[i] && !(factor.rows[place[i]][0].1.abs() >= (2.0 * eta).sqrt())).collect();
            if dependent.is_empty() { factored = Some((factor, eta)); break; }
            for i in dependent { kept[i] = false; }
        }
        let Some((factor, eta)) = factored else { return Ok(Curvature::Unresolved); };
        let positions: Vec<usize> = { let mut at = vec![false; m]; for i in 0..m { at[place[i]] = kept[i]; } (0..m).filter(|&k| at[k]).collect() };
        let solves = |count: usize| count * positions.iter().map(|&k| factor.rows[k].len()).sum::<usize>();

        // Rows left out decouple with only their damping and keep a zero multiplier.
        let remainder = |by_position: &[f64]| -> Vec<f64> {
            columns.iter().zip(&g).map(|(column, &g)| g + column.iter().filter(|&&(i, _)| kept[i]).map(|&(i, v)| v * by_position[place[i]]).sum::<f64>()).collect()
        };
        let Some(mut by_position) = factor.solve() else { return Ok(Curvature::Unresolved); };
        let mut kkt = remainder(&by_position);
        // Corrected seminormal steps, `R^T R delta = -J k`, recover what the seminormal solve loses.
        for _ in 0..REFINEMENTS {
            let mut jk = vec![0.0; m];
            for (column, &k) in columns.iter().zip(&kkt) { for &(i, v) in column { if kept[i] { jk[place[i]] -= v * k; } } }
            let Some(delta) = factor.solve_transposed(&jk).and_then(|y| factor.solve_with(&y)) else { return Ok(Curvature::Unresolved); };
            for (lambda, delta) in by_position.iter_mut().zip(&delta) { *lambda += delta; }
            kkt = remainder(&by_position);
        }
        // The multipliers explain the gradient up to its small projected part.
        if !(norm(&kkt) <= 2.0 * self.stationary) { return Ok(Curvature::Unresolved); }
        let lambda: Vec<f64> = (0..m).map(|i| if kept[i] { by_position[place[i]] } else { 0.0 }).collect();

        // A verified bound `bound >= |R^-1|`. The comparison matrix, `|r_kk|` on the diagonal and
        // `-|r_kj|` off it, has a nonnegative inverse that bounds `|R^-1|` entrywise, and its row and
        // column sums come by substitutions of positive terms, which cannot cancel.
        let widest = positions.iter().map(|&k| factor.rows[k].len()).max().unwrap_or(1);
        let size_r = positions.iter().flat_map(|&k| &factor.rows[k]).map(|&(_, v)| v * v).sum::<f64>().sqrt();
        let (mut down, mut up, mut sums) = (vec![0.0; m], vec![0.0; m], vec![1.0; m]);
        for &k in positions.iter().rev() {
            let row = &factor.rows[k];
            down[k] = (1.0 + row[1..].iter().map(|&(j, v)| v.abs() * down[j]).sum::<f64>()) / row[0].1.abs();
        }
        for &k in &positions {
            let row = &factor.rows[k];
            up[k] = sums[k] / row[0].1.abs();
            for &(j, v) in &row[1..] { sums[j] += v.abs() * up[k]; }
        }
        let largest = |values: &[f64]| values.iter().fold(0.0_f64, |most, &v| most.max(v));
        let mut bound = (largest(&down) * largest(&up)).sqrt() * (1.0 + gamma((widest + 2) * m));
        let smallest = positions.iter().map(|&k| factor.rows[k][0].1.abs()).fold(f64::INFINITY, f64::min);
        // Far above `1 / min |r_kk|`, a lower bound on `|R^-1|`, the comparison is loose: the exact
        // Frobenius norm, verified against the solves' roundoff, may be tighter.
        if bound * smallest > 8.0 {
            let allowance = 4 * factor.work;
            let (frobenius, spent) = frobenius(&factor, &positions, m, allowance);
            self.work = self.work.saturating_add(spent);
            if let Some(f) = frobenius && gamma(widest) * size_r * f <= 0.5 { bound = bound.min(2.0 * f); }
        }
        // `sigma` bounds the smallest singular value of the kept rows from below.
        let floor = if bound > 0.0 { 1.0 / (bound * bound) } else { f64::INFINITY };
        if !(floor >= 2.0 * eta) { return Ok(Curvature::Unresolved); }
        let sigma = (floor - eta).sqrt();
        // The relative error of a solve pair against `(R^T R)^-1`.
        let drift = 2.5 * bound * gamma(widest) * size_r;
        if !(drift <= 0.5) { return Ok(Curvature::Unresolved); }
        let tallest = columns.iter().map(Vec::len).max().unwrap_or(0);

        let Some(mut curved) = self.curved(values, &rows, &lambda) else { return Ok(Curvature::Unresolved); };
        // Each curved row's multiplier error. With `A = J J^T` and the remainder `k = g + J^T lambda`,
        // `lambda_i - lambda*_i = p_i^T k` exactly for `p_i = J^T A^-1 e_i`; the computed `p_i`,
        // the remainder's own roundoff and their product are each bounded. Multipliers of rows not
        // coupled to row `i` reach it only through `p_i`'s columns.
        let slack: Vec<f64> = columns.iter().zip(&g).map(|(column, &g)| {
            let terms: Vec<f64> = column.iter().filter(|&&(i, _)| kept[i]).map(|&(i, v)| (v * lambda[i]).abs()).collect();
            gamma(terms.len() + 3) * (g.abs() + terms.iter().sum::<f64>())
        }).collect();
        let (size_k, size_slack) = (norm(&kkt), norm(&slack));
        let dot = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(a, b)| a * b).sum::<f64>();
        for row in &mut curved {
            let mut e = vec![0.0; m];
            e[place[row.index]] = 1.0;
            let Some(w) = factor.solve_transposed(&e).and_then(|y| factor.solve_with(&y)) else { return Ok(Curvature::Unresolved); };
            let (mut p, mut magnitude) = (vec![0.0; n], vec![0.0; n]);
            for (c, column) in columns.iter().enumerate() {
                for &(i, v) in column { if kept[i] { p[c] += v * w[place[i]]; magnitude[c] += (v * w[place[i]]).abs(); } }
            }
            let absolute: Vec<f64> = p.iter().map(|p| p.abs()).collect();
            let wrong = (2.0 * eta / sigma + 2.0 * drift * size_j) * norm(&w) + gamma(tallest + 1) * norm(&magnitude);
            let k_abs: Vec<f64> = kkt.iter().map(|k| k.abs()).collect();
            row.spread = norm(&p);
            row.uncertainty = dot(&p, &kkt).abs() + dot(&absolute, &slack) + wrong * (size_k + size_slack) + gamma(n + 1) * dot(&absolute, &k_abs);
        }
        self.work = self.work.saturating_add(solves(2 + 2 * REFINEMENTS + 2 * curved.len()));
        if self.work > self.limits.work { return Ok(Curvature::Unresolved); }

        // A curved row carries curvature only when its multiplier is resolved: beyond its own error
        // and the change the first-order tolerance allows, `|p_i|` per unit of remainder. Others count
        // as carrying none, a documented limit of the test.
        let curved: Vec<&Curved> = curved.iter().filter(|row| row.lambda.abs() > row.uncertainty + 2.0 * row.spread * self.stationary).collect();
        // No curved row carries a resolved multiplier: the curvature is the targets' alone, never negative.
        if curved.is_empty() { return Ok(Curvature::Clear); }
        let total: f64 = curved.iter().map(|row| row.lambda.abs() * row.size).sum();
        // What the curvature on the support is known to: each row's differencing error, its
        // multiplier's error against its curvature, and roundoff in the eigensolves.
        let tolerance = curved.iter().map(|row| row.lambda.abs() * row.size * row.error + row.uncertainty * row.size).sum::<f64>()
            + 64.0 * f64::EPSILON * (1.0 + total) * (self.targets.len() + curved.iter().map(|row| row.columns.len()).sum::<usize>()) as f64;

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
        // The null-space projector's columns on the support, `L = P E_S`. With `Z` an orthonormal
        // basis of the null space, `L = Z Z_S^T`, so its singular values are the support's shares of
        // the null directions, unsquared, and its right singular vectors span the support's part of
        // the null space. Each column's error is bounded: the damping and backward error `eta`, the
        // solves' drift and the products' roundoff.
        let (mut lifted, mut squared) = (Vec::with_capacity(s), 0.0);
        for &column in &support {
            let mut b = vec![0.0; m];
            for &(i, v) in &columns[column] { if kept[i] { b[place[i]] = v; } }
            let Some(w) = factor.solve_transposed(&b).and_then(|y| factor.solve_with(&y)) else { return Ok(Curvature::Unresolved); };
            let (mut p, mut magnitude) = (vec![0.0; n], 0.0);
            p[column] = 1.0;
            for (c, entries) in columns.iter().enumerate() {
                let (mut sum, mut size) = (0.0, 0.0);
                for &(i, v) in entries { if kept[i] { sum += v * w[place[i]]; size += (v * w[place[i]]).abs(); } }
                p[c] -= sum;
                magnitude += size * size;
            }
            let wrong = (2.0 * eta / sigma + 2.0 * drift * size_j) * norm(&w) + gamma(tallest + 1) * magnitude.sqrt();
            squared += wrong * wrong;
            lifted.push(p);
        }
        self.work = self.work.saturating_add(solves(2 * s) + n * s * s);
        if self.work > self.limits.work { return Ok(Curvature::Unresolved); }
        let size_l = lifted.iter().flatten().map(|v| v * v).sum::<f64>().sqrt();
        let error = squared.sqrt() + (4.0 * (n + 4 * s) as f64 * (s as f64).sqrt() + 64.0 * s as f64) * f64::EPSILON * size_l;
        let (shares, vectors) = singular(&lifted);
        // A share within twice its error is held to the Jacobian's backward error: a perturbation of
        // that size holds it exactly. One between that and eight times its error is not resolved.
        if shares.iter().any(|&share| share > 2.0 * error && share < 8.0 * error) { return Ok(Curvature::Unresolved); }
        let moving: Vec<usize> = (0..s).filter(|&k| shares[k] >= 8.0 * error).collect();
        // Nothing along the lasting rows moves the support: the targets and every curved row are held.
        if moving.is_empty() { return Ok(Curvature::Clear); }
        // The curvature per unit of support motion, over an orthonormal basis `V` of the support's
        // part of the null space; the basis is known to `error / sigma_min` of `L`.
        let size_h = hessian.iter().flatten().map(|h| h * h).sum::<f64>().sqrt();
        let least = moving.iter().map(|&k| shares[k]).fold(f64::INFINITY, f64::min);
        let tolerance = tolerance + 6.0 * size_h * error / least;
        let along = |a: &[f64], b: &[f64]| (0..s).map(|i| a[i] * dot(&hessian[i], b)).sum::<f64>();
        let reduced: Vec<Vec<f64>> = moving.iter().map(|&a| moving.iter().map(|&b| along(&vectors[a], &vectors[b])).collect()).collect();
        let (curvatures, directions) = symmetric_eigen(reduced);
        let (lowest, &theta) = curvatures.iter().enumerate().min_by(|a, b| a.1.total_cmp(b.1)).unwrap();
        if theta > tolerance { return Ok(Curvature::Clear); }
        // The direction's part on the targeted columns, against the basis' error.
        let mut v = vec![0.0; s];
        for (&k, &y) in moving.iter().zip(&directions[lowest]) { for (v, w) in v.iter_mut().zip(&vectors[k]) { *v += y * w; } }
        let targeted = self.targets.iter().map(|target| v[index(target.column).unwrap()].powi(2)).sum::<f64>().sqrt();
        let still = targeted <= 8.0 * error / least;
        // Lifted to the least-norm null direction with support part `v = V y`: `d = L V Sigma^-2 y`.
        let mut u = vec![0.0; s];
        for (&k, &y) in moving.iter().zip(&directions[lowest]) {
            let scale = y / (shares[k] * shares[k]);
            for (u, v) in u.iter_mut().zip(&vectors[k]) { *u += scale * v; }
        }
        let mut d = vec![0.0; n];
        for (p, &u) in lifted.iter().zip(&u) { for (d, p) in d.iter_mut().zip(p) { *d += u * p; } }
        // One projection removes what roundoff left across the lasting rows.
        let jacobian = self.jacobian(values);
        let Some((d, _)) = self.project(&jacobian, &d)? else { return Ok(Curvature::Unresolved); };
        let length = norm(&d);
        if !(length > 0.0 && length.is_finite()) { return Ok(Curvature::Unresolved); }
        let direction: Vec<f64> = d.iter().map(|value| value / length).collect();
        // `descend` weighs its gains per unit of the whole direction.
        let part: Vec<f64> = support.iter().map(|&column| direction[column]).collect();
        let bent = along(&part, &part);
        Ok(if theta < -tolerance && bent < 0.0 { Curvature::Negative { direction, theta: bent } } else { Curvature::Flat { direction, still } })
    }

    /// Whether `row`, of equation `e`, is a nonlinear row collapsed to a length its coordinates
    /// cannot resolve.
    fn collapsed(&self, values: &[f64], e: usize, row: &crate::newton::Row) -> bool {
        let equation = &self.lasting.problem.equations[e];
        let operands: Vec<f64> = equation.operands.iter().map(|&p| values[p]).collect();
        let free: Vec<bool> = equation.operands.iter().map(|&p| self.lasting.column[p] != usize::MAX).collect();
        row_length(equation.kind, &operands, &free).is_some_and(|length| !(length > 64.0 * f64::EPSILON * row.scale))
    }

    /// The nonlinear rows with a nonzero multiplier and their Hessians, by central differences of
    /// the exact gradient with each row's weight held. The step balances truncation, about
    /// `delta^2 / L^2` relative for a row of length `L`, against coordinate roundoff,
    /// `epsilon S / delta`. `None` when a row with a multiplier has collapsed, which the relaxation
    /// should have left out.
    fn curved(&self, values: &[f64], rows: &[crate::newton::Row], lambda: &[f64]) -> Option<Vec<Curved>> {
        let problem = self.lasting.problem;
        let mut curved = Vec::new();
        for (index, ((&e, row), &lambda)) in self.lasting.equations.iter().zip(rows).zip(lambda).enumerate() {
            if lambda == 0.0 || row.len == 0 { continue; }
            let equation = &problem.equations[e];
            let operands: Vec<f64> = equation.operands.iter().map(|&p| values[p]).collect();
            let free: Vec<bool> = equation.operands.iter().map(|&p| self.lasting.column[p] != usize::MAX).collect();
            let Some(length) = row_length(equation.kind, &operands, &free) else { continue; };
            if !(length > 64.0 * f64::EPSILON * row.scale) { return None; }
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
            curved.push(Curved { columns, hessian, lambda, size, error: 4.0 * (f64::EPSILON * row.scale / length).powf(2.0 / 3.0), index, uncertainty: 0.0, spread: 0.0 });
        }
        Some(curved)
    }
}
