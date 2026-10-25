//! Damped Gauss-Newton (Levenberg-Marquardt with Nielsen's damping update), run separately on
//! each connected group of unknowns. Each step solves `(J^T J + mu I) h = -J^T r`; `h` stays in the row
//! space of `J`, so free directions of an under-constrained sketch do not move.
//!
//! Every equation is divided by its gradient norm at the start of each step, so each residual
//! reads as a distance in sketch units whatever the equation kind or the size of its geometry.

use crate::dual::{Dual, WIDTH};
use crate::equations::residual;
use crate::problem::{Problem, Status};

pub const MAX_ITERATIONS: usize = 100;
/// A solution is accepted when each normalized residual is at most this times its local scale.
pub const ACCEPT: f64 = 1e-10;
/// Steps continue past acceptance while they improve, up to roundoff at this level.
const POLISH: f64 = 2.0 * f64::EPSILON;
const POLISH_STEPS: usize = 3;

#[derive(Clone, Copy, Debug)]
pub struct Outcome {
    pub status: Status,
    pub iterations: usize,
    /// Largest normalized residual divided by its local scale.
    pub residual: f64,
}

/// One normalized Jacobian row with its unknown columns; fixed operands have no column.
#[derive(Clone)]
struct Row {
    columns: [usize; WIDTH],
    derivatives: [f64; WIDTH],
    len: usize,
    residual: f64,
    /// Largest operand magnitude, at least one.
    scale: f64,
    weight: f64,
}

/// One connected group: its equations and unknown parameters.
struct System<'a> {
    problem: &'a Problem,
    /// Column of each parameter within its group, or `usize::MAX` when it is fixed or unused.
    column: &'a [usize],
    equations: Vec<usize>,
    unknowns: Vec<usize>,
}

impl System<'_> {
    /// Rows at `values`; `weights` from an earlier evaluation keep one cost function per step.
    fn rows(&self, values: &[f64], weights: Option<&[Row]>) -> Vec<Row> {
        self.equations.iter().enumerate().map(|(index, &equation)| {
            let equation = &self.problem.equations[equation];
            let operands: Vec<Dual> = equation.operands.iter().enumerate().map(|(slot, &p)| Dual::variable(values[p], slot)).collect();
            let result = residual(equation.kind, &operands, equation.value);
            let mut row = Row { columns: [0; WIDTH], derivatives: [0.0; WIDTH], len: 0, residual: result.value, scale: 1.0, weight: 1.0 };
            for (slot, &p) in equation.operands.iter().enumerate() {
                row.scale = row.scale.max(values[p].abs());
                if self.column[p] != usize::MAX {
                    row.columns[row.len] = self.column[p];
                    row.derivatives[row.len] = result.gradient[slot];
                    row.len += 1;
                }
            }
            row.weight = match weights {
                Some(rows) => rows[index].weight,
                None => {
                    let norm = row.derivatives[..row.len].iter().map(|d| d * d).sum::<f64>().sqrt();
                    if norm > 0.0 && norm.is_finite() { (1.0 / norm).min(1e12) } else { 1.0 }
                }
            };
            row.residual *= row.weight;
            for derivative in &mut row.derivatives[..row.len] { *derivative *= row.weight; }
            row
        }).collect()
    }

    /// Lower triangle of `J^T J` and `J^T r`. Repeated columns in one row add up.
    fn normal(&self, rows: &[Row]) -> (Vec<f64>, Vec<f64>) {
        let n = self.unknowns.len();
        let (mut a, mut g) = (vec![0.0; n * n], vec![0.0; n]);
        for row in rows {
            for i in 0..row.len {
                g[row.columns[i]] += row.derivatives[i] * row.residual;
                for j in 0..row.len {
                    if row.columns[i] >= row.columns[j] {
                        a[row.columns[i] * n + row.columns[j]] += row.derivatives[i] * row.derivatives[j];
                    }
                }
            }
        }
        (a, g)
    }
}

/// Largest residual relative to its scale; NaN when any residual is not finite.
fn worst(rows: &[Row]) -> f64 {
    rows.iter().fold(0.0, |max: f64, row| if row.residual.is_finite() { max.max(row.residual.abs() / row.scale) } else { f64::NAN })
}

fn cost(rows: &[Row]) -> f64 { 0.5 * rows.iter().map(|row| row.residual * row.residual).sum::<f64>() }

/// Solves `(a + mu I) x = b` with `a` symmetric (lower triangle used); `None` unless positive definite.
fn cholesky_solve(a: &[f64], mu: f64, b: &[f64]) -> Option<Vec<f64>> {
    let n = b.len();
    let mut l = vec![0.0; n * n];
    for i in 0..n {
        for j in 0..=i {
            let mut sum = a[i * n + j] + if i == j { mu } else { 0.0 };
            for k in 0..j { sum -= l[i * n + k] * l[j * n + k]; }
            if i == j {
                if !(sum > 0.0) { return None; }
                l[i * n + i] = sum.sqrt();
            } else {
                l[i * n + j] = sum / l[j * n + j];
            }
        }
    }
    let mut x = b.to_vec();
    for i in 0..n {
        for k in 0..i { x[i] -= l[i * n + k] * x[k]; }
        x[i] /= l[i * n + i];
    }
    for i in (0..n).rev() {
        for k in i + 1..n { x[i] -= l[k * n + i] * x[k]; }
        x[i] /= l[i * n + i];
    }
    x.iter().all(|value| value.is_finite()).then_some(x)
}

/// Equations and unknowns of each group joined by shared unknowns, in first-equation order,
/// and each unknown's column within its group. Equations without unknowns form one group.
fn groups(problem: &Problem) -> (Vec<(Vec<usize>, Vec<usize>)>, Vec<usize>) {
    fn root(parent: &mut [usize], mut p: usize) -> usize {
        while parent[p] != p { parent[p] = parent[parent[p]]; p = parent[p]; }
        p
    }
    let unknown = |equation: &crate::problem::Equation| equation.operands.iter().copied().filter(|&p| !problem.fixed[p]).collect::<Vec<_>>();
    let mut parent: Vec<usize> = (0..problem.values.len()).collect();
    for equation in &problem.equations {
        let operands = unknown(equation);
        for &p in operands.iter().skip(1) { let (a, b) = (root(&mut parent, operands[0]), root(&mut parent, p)); parent[a] = b; }
    }
    let (mut column, mut group) = (vec![usize::MAX; problem.values.len()], vec![usize::MAX; problem.values.len()]);
    let (mut members, mut constant): (Vec<(Vec<usize>, Vec<usize>)>, Vec<usize>) = (Vec::new(), Vec::new());
    for (index, equation) in problem.equations.iter().enumerate() {
        let operands = unknown(equation);
        let Some(&first) = operands.first() else { constant.push(index); continue; };
        let r = root(&mut parent, first);
        if group[r] == usize::MAX { group[r] = members.len(); members.push((Vec::new(), Vec::new())); }
        let (equations, unknowns) = &mut members[group[r]];
        equations.push(index);
        for p in operands {
            if column[p] == usize::MAX { column[p] = unknowns.len(); unknowns.push(p); }
        }
    }
    if !constant.is_empty() { members.push((constant, Vec::new())); }
    (members, column)
}

/// Moves the unknowns of `values` onto a solution, or as close as the iterations allow. The
/// status is the worst group's; iterations are the most any group took.
pub fn solve(problem: &Problem, values: &mut [f64]) -> Outcome {
    let (members, column) = groups(problem);
    let mut outcome = Outcome { status: Status::Converged, iterations: 0, residual: 0.0 };
    for (equations, unknowns) in members {
        let group = solve_group(&System { problem, column: &column, equations, unknowns }, values);
        outcome.iterations = outcome.iterations.max(group.iterations);
        outcome.residual = if outcome.residual.is_nan() || group.residual.is_nan() { f64::NAN } else { outcome.residual.max(group.residual) };
        if group.status != Status::Converged { outcome.status = Status::NotConverged; }
    }
    outcome
}

fn solve_group(system: &System, values: &mut [f64]) -> Outcome {
    let n = system.unknowns.len();
    let mut rows = system.rows(values, None);
    let mut error = worst(&rows);
    let finish = |error: f64, iterations| Outcome { status: if error <= ACCEPT { Status::Converged } else { Status::NotConverged }, iterations, residual: error };
    if !(error > POLISH) || n == 0 { return finish(error, 0); }
    let (mut a, mut g) = system.normal(&rows);
    let diagonal = (0..n).fold(0.0_f64, |max, i| max.max(a[i * n + i]));
    let floor = 1e-12 * diagonal.max(1.0);
    let (mut mu, mut nu) = ((1e-6 * diagonal).max(floor), 2.0);
    let (mut iterations, mut polished) = (0, 0);
    while iterations < MAX_ITERATIONS {
        iterations += 1;
        let negative: Vec<f64> = g.iter().map(|value| -value).collect();
        let mut accepted = false;
        if let Some(h) = cholesky_solve(&a, mu, &negative) {
            if system.unknowns.iter().zip(&h).all(|(&p, step)| step.abs() <= f64::EPSILON * values[p].abs().max(1.0)) { break; }
            let saved: Vec<f64> = system.unknowns.iter().map(|&p| values[p]).collect();
            for (column, &p) in system.unknowns.iter().enumerate() { values[p] += h[column]; }
            let next = system.rows(values, Some(&rows));
            let predicted = 0.5 * h.iter().zip(&g).map(|(step, gradient)| step * (mu * step - gradient)).sum::<f64>();
            let reduction = cost(&rows) - cost(&next);
            if reduction > 0.0 && predicted > 0.0 {
                accepted = true;
                let rho = reduction / predicted;
                mu = (mu * (1.0 / 3.0_f64).max(1.0 - (2.0 * rho - 1.0).powi(3))).max(floor);
                nu = 2.0;
                rows = system.rows(values, None);
                error = worst(&rows);
                if !(error > POLISH) { break; }
                if error <= ACCEPT { polished += 1; if polished >= POLISH_STEPS { break; } }
                (a, g) = system.normal(&rows);
            } else {
                for (&p, &value) in system.unknowns.iter().zip(&saved) { values[p] = value; }
            }
        }
        if !accepted {
            // Past acceptance, the first step without gain is roundoff.
            if error <= ACCEPT { break; }
            mu *= nu;
            nu *= 2.0;
            if !mu.is_finite() { break; }
        }
    }
    finish(error, iterations)
}
