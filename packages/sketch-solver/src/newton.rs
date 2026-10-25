//! Damped Gauss-Newton (Levenberg-Marquardt with Nielsen's damping update), run separately on
//! each connected group of unknowns. Each step minimizes `|J h + r|^2 + mu |h|^2` through a sparse
//! Givens QR of `J` (see `sparse`) rather than the normal equations, whose squared condition
//! number would let roundoff move free directions of an under-constrained sketch once damping is
//! small.
//!
//! Every equation is divided by its gradient norm over the unknowns at the start of each step,
//! so each residual reads as the distance its unknowns must move. Convergence is judged apart from
//! that weighting, in millimetres; the sketch graph checks remain the authority on every result.

use crate::dual::{Dual, WIDTH};
use crate::equations::{is_direction, reach, residual};
use crate::problem::{Problem, Status};
use crate::sparse::{Factor, SparseRow, minimum_degree};

pub const MAX_ITERATIONS: usize = 100;
/// Resource bounds on one group. Native code cannot be interrupted, so these bound one solve.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// Entries of the factor `R`, known from structure before any numeric work.
    pub fill: usize,
    /// Entries written by the ordering and every factor, checked at each rotation.
    pub work: usize,
}
/// About 32 MiB of factor and a second or two of rotations.
pub const LIMITS: Limits = Limits { fill: 2_000_000, work: 400_000_000 };
/// A solution is accepted when each residual is within `max(ACCEPT_MM, 8 epsilon x scale)`
/// millimetres, the driver tolerance, and each direction error within `ACCEPT_RADIANS` or the
/// roundoff its coordinates allow at the far end of its longer line.
pub const ACCEPT_MM: f64 = 1e-10;
pub const ACCEPT_RADIANS: f64 = 1e-12;
/// Damping drops to near roundoff once each weighted residual is within this times its scale.
const NEAR: f64 = 1e-10;
/// Steps continue past acceptance while they improve, down to roundoff at this level.
const POLISH: f64 = 2.0 * f64::EPSILON;

#[derive(Clone, Copy, Debug)]
pub struct Outcome {
    pub status: Status,
    pub iterations: usize,
    /// Largest residual in millimetres; NaN when any residual is not finite.
    pub residual: f64,
}

/// One normalized Jacobian row over distinct unknown columns; fixed operands have no column.
#[derive(Clone)]
struct Row {
    columns: [usize; WIDTH],
    derivatives: [f64; WIDTH],
    len: usize,
    residual: f64,
    /// Unweighted residual in millimetres; a direction error moves the longer line's far end.
    millimetres: f64,
    /// Unweighted direction error, zero for length equations.
    radians: f64,
    /// Millimetres per unit of residual.
    reach: f64,
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
            let raw: Vec<f64> = equation.operands.iter().map(|&p| values[p]).collect();
            let reach = reach(equation.kind, &raw);
            let mut row = Row { columns: [0; WIDTH], derivatives: [0.0; WIDTH], len: 0, residual: result.value,
                millimetres: (result.value * reach).abs(), reach,
                radians: if is_direction(equation.kind) { result.value.abs() } else { 0.0 },
                scale: raw.iter().fold(1.0, |scale: f64, value| scale.max(value.abs())), weight: 1.0 };
            for (slot, &p) in equation.operands.iter().enumerate() {
                let column = self.column[p];
                if column == usize::MAX { continue; }
                // An operand repeated in one equation has one derivative, the sum of its slots.
                match row.columns[..row.len].iter().position(|&c| c == column) {
                    Some(existing) => row.derivatives[existing] += result.gradient[slot],
                    None => {
                        row.columns[row.len] = column;
                        row.derivatives[row.len] = result.gradient[slot];
                        row.len += 1;
                    }
                }
            }
            row.weight = match weights {
                Some(rows) => rows[index].weight,
                None => {
                    // Fixed operands stay out of the norm: a short fixed guide must not shrink the
                    // row its movable operands have to satisfy.
                    let norm = row.derivatives[..row.len].iter().map(|d| d * d).sum::<f64>().sqrt();
                    if norm > 0.0 && norm.is_finite() { (1.0 / norm).min(1e12) } else { 1.0 }
                }
            };
            row.residual *= row.weight;
            for derivative in &mut row.derivatives[..row.len] { *derivative *= row.weight; }
            row
        }).collect()
    }

    /// The weighted Jacobian in column `position` order, with `J^T r` and the largest diagonal
    /// entry of `J^T J`.
    fn jacobian(&self, rows: &[Row], position: &[usize]) -> Jacobian {
        let n = self.unknowns.len();
        let mut jacobian = Jacobian { rows: Vec::with_capacity(rows.len()), gradient: vec![0.0; n], diagonal: 0.0 };
        let mut squares = vec![0.0; n];
        for row in rows {
            let mut sparse: SparseRow = Vec::with_capacity(row.len);
            for i in 0..row.len {
                let (column, derivative) = (row.columns[i], row.derivatives[i]);
                jacobian.gradient[column] += derivative * row.residual;
                squares[column] += derivative * derivative;
                if derivative != 0.0 { sparse.push((position[column], derivative)); }
            }
            // At most `WIDTH` entries, so insertion sort.
            for i in 1..sparse.len() {
                let mut j = i;
                while j > 0 && sparse[j - 1].0 > sparse[j].0 { sparse.swap(j - 1, j); j -= 1; }
            }
            jacobian.rows.push((sparse, -row.residual));
        }
        jacobian.diagonal = squares.iter().fold(0.0, |max: f64, &square| max.max(square));
        jacobian
    }
}

/// One step's weighted Jacobian rows with right-hand sides `-r`, by column position.
struct Jacobian {
    rows: Vec<(SparseRow, f64)>,
    gradient: Vec<f64>,
    diagonal: f64,
}

/// The step minimizing `|J h + r|^2 + mu |h|^2` in column order, or `None` when it is not finite.
/// `Err` when the work would pass `limit`.
fn damped_step(jacobian: &Jacobian, position: &[usize], mu: f64, work: &mut usize, limit: usize) -> Result<Option<Vec<f64>>, Exhausted> {
    let mut factor = Factor::damped(position.len(), mu, limit.saturating_sub(*work));
    let finished = jacobian.rows.iter().all(|(row, rhs)| factor.rotate(row.clone(), *rhs));
    *work = work.saturating_add(factor.work);
    if !finished { return Err(Exhausted); }
    Ok(factor.solve().map(|x| position.iter().map(|&k| x[k]).collect()))
}

/// The work limit ran out.
struct Exhausted;

/// How close a group is to a solution; a residual that is not finite is none of these.
#[derive(Clone, Copy)]
struct Progress {
    /// Inside Newton's quadratic region, measured in the distances the unknowns must move.
    near: bool,
    accepted: bool,
    /// Accepted and at roundoff, so further steps cannot help.
    polished: bool,
}

fn assess(rows: &[Row]) -> Progress {
    rows.iter().fold(Progress { near: true, accepted: true, polished: true }, |progress, row| {
        let roundoff = 8.0 * f64::EPSILON * row.scale;
        let angle = if row.reach > 0.0 { ACCEPT_RADIANS.max(roundoff / row.reach) } else { ACCEPT_RADIANS };
        let accepted = row.millimetres <= ACCEPT_MM.max(roundoff) && row.radians <= angle;
        Progress {
            near: progress.near && row.residual.abs() <= NEAR * row.scale,
            accepted: progress.accepted && accepted,
            // Directions polish toward the graph checks' strict angular bound even where roundoff
            // allows acceptance, since a representable correction often exists.
            polished: progress.polished && accepted && row.millimetres <= POLISH * row.scale && row.radians <= POLISH,
        }
    })
}

/// Largest residual in millimetres; NaN when any residual is not finite.
fn worst(rows: &[Row]) -> f64 {
    rows.iter().fold(0.0, |max: f64, row| if max.is_nan() || !row.millimetres.is_finite() { f64::NAN } else { max.max(row.millimetres) })
}

fn cost(rows: &[Row]) -> f64 { 0.5 * rows.iter().map(|row| row.residual * row.residual).sum::<f64>() }

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
pub fn solve(problem: &Problem, values: &mut [f64]) -> Outcome { solve_within(problem, values, LIMITS) }

/// `solve` with other limits. A group whose factor would exceed `limits.fill` is left where it
/// is; one that spends `limits.work` stops where it got to. Either reports `TooLarge`.
pub fn solve_within(problem: &Problem, values: &mut [f64], limits: Limits) -> Outcome {
    let (members, column) = groups(problem);
    let mut outcome = Outcome { status: Status::Converged, iterations: 0, residual: 0.0 };
    for (equations, unknowns) in members {
        let group = solve_group(&System { problem, column: &column, equations, unknowns }, values, limits);
        outcome.iterations = outcome.iterations.max(group.iterations);
        outcome.residual = if outcome.residual.is_nan() || group.residual.is_nan() { f64::NAN } else { outcome.residual.max(group.residual) };
        if outcome.status != Status::TooLarge && group.status != Status::Converged { outcome.status = group.status; }
    }
    outcome
}

fn solve_group(system: &System, values: &mut [f64], limits: Limits) -> Outcome {
    let n = system.unknowns.len();
    let mut rows = system.rows(values, None);
    let mut progress = assess(&rows);
    let finish = |rows: &[Row], progress: Progress, iterations, exhausted| Outcome {
        status: if progress.accepted { Status::Converged } else if exhausted { Status::TooLarge } else { Status::NotConverged },
        iterations, residual: worst(rows) };
    if progress.polished || n == 0 { return finish(&rows, progress, 0, false); }
    let Some(ordering) = minimum_degree(n, &rows.iter().map(|row| &row.columns[..row.len]).collect::<Vec<_>>(), limits.fill, limits.work)
        else { return finish(&rows, progress, 0, true); };
    let (position, mut work) = (ordering.position, ordering.work);
    let mut jacobian = system.jacobian(&rows, &position);
    let (diagonal, mut exhausted) = (jacobian.diagonal, false);
    // Damping well below the smallest useful curvature during the search, and near roundoff
    // once near: a near-tangent intersection has tiny singular values that a larger floor would
    // swamp, turning Newton's quadratic convergence linear. A start that is already near polishes.
    let (floor, polish_floor) = (1e-12 * diagonal.max(1.0), f64::EPSILON * diagonal.max(1.0));
    let (mut mu, mut nu) = (if progress.near { polish_floor } else { (1e-6 * diagonal).max(floor) }, 2.0);
    let mut iterations = 0;
    while iterations < MAX_ITERATIONS {
        iterations += 1;
        let (mut stepped, mut rejected) = (false, false);
        let Ok(step) = damped_step(&jacobian, &position, mu, &mut work, limits.work) else { exhausted = true; break; };
        if let Some(h) = step {
            if system.unknowns.iter().zip(&h).all(|(&p, step)| values[p] + step == values[p]) { break; }
            let saved: Vec<f64> = system.unknowns.iter().map(|&p| values[p]).collect();
            for (column, &p) in system.unknowns.iter().enumerate() { values[p] += h[column]; }
            let next = system.rows(values, Some(&rows));
            let predicted = 0.5 * h.iter().zip(&jacobian.gradient).map(|(step, gradient)| step * (mu * step - gradient)).sum::<f64>();
            let reduction = cost(&rows) - cost(&next);
            if reduction > 0.0 && predicted > 0.0 {
                stepped = true;
                let (rho, searching) = (reduction / predicted, !progress.near);
                rows = system.rows(values, None);
                progress = assess(&rows);
                if progress.polished { break; }
                mu = if searching && progress.near { polish_floor }
                    else { (mu * (1.0 / 3.0_f64).max(1.0 - (2.0 * rho - 1.0).powi(3))).max(if progress.near { polish_floor } else { floor }) };
                nu = 2.0;
                jacobian = system.jacobian(&rows, &position);
            } else {
                for (&p, &value) in system.unknowns.iter().zip(&saved) { values[p] = value; }
                rejected = true;
            }
        }
        if !stepped {
            // Past acceptance, a computed step without gain is roundoff; a step that is not
            // finite only needs more damping.
            if rejected && progress.accepted { break; }
            mu *= nu;
            nu *= 2.0;
            if !mu.is_finite() { break; }
        }
    }
    finish(&rows, progress, iterations, exhausted)
}
