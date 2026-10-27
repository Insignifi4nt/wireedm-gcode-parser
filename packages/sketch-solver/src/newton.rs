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
use crate::equations::{Kind, is_direction, reach, residual};
use crate::diagnose::{self, CONFLICTING, STALLED, TAU, Witness, diagnose};
use crate::problem::{Diagnosis, Problem, Status};
use crate::sparse::{Factor, SparseRow, minimum_degree};

mod drag;
mod eliminate;
#[cfg(test)]
mod tests;
pub use drag::{DRAG_ITERATIONS, DragOutcome};

pub const MAX_ITERATIONS: usize = 100;
/// Resource bounds on one group. Native code cannot be interrupted, so these bound one solve.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    /// Entries of the factor `R`, known from structure before any numeric work.
    pub fill: usize,
    /// Entries written by a group's ordering, factors and diagnosis together, checked at each
    /// rotation. Labelling, across groups, has its own allowance of the same size.
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
/// Past acceptance, a step gaining less than this part of its predicted gain, and less than
/// `NEGLIGIBLE` of the cost, is taken as roundoff. Steps that move only roundoff gain about 1e-14
/// of their prediction and 1e-14 of the cost. With damping at `polish_floor`, a real gain below
/// `NEGLIGIBLE` needs a direction whose squared singular value is below 512 epsilon squared of
/// the diagonal, dependent at any distance used here. A step near a tangency can gain a real part
/// of the cost with a low ratio, so the ratio alone does not decide. A single such step can still be
/// real, so polishing stops at the second in a row.
const STAGNANT: f64 = 0.25;
const NEGLIGIBLE: f64 = 1024.0 * f64::EPSILON;

#[derive(Clone, Debug)]
pub struct Outcome {
    pub status: Status,
    pub iterations: usize,
    /// Largest residual in millimetres; NaN when any residual is not finite.
    pub residual: f64,
    pub diagnosis: Diagnosis,
    /// Unknowns less the rank of the lasting equations, when diagnosed exactly without conflicts.
    pub degrees_of_freedom: Option<usize>,
    /// `diagnose` label bits of each equation, zero unless diagnosed.
    pub labels: Vec<u8>,
    /// How the drag targets ended, the worst of any group's; `None` without targets.
    pub drag: Option<DragOutcome>,
    /// Euclidean distance in millimetres from the targeted coordinates to their targets, fixed
    /// ones included; NaN without targets.
    pub target_distance: f64,
}

/// One group's result and the column order its factor used.
struct GroupOutcome {
    status: Status,
    iterations: usize,
    residual: f64,
    position: Option<Vec<usize>>,
    /// Work spent, which diagnosis continues from.
    work: usize,
    /// A group with drag targets: how they ended and their squared distance.
    drag: Option<(DragOutcome, f64)>,
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
    /// Largest weighted residual that is accepted.
    tolerance: f64,
}

/// One connected group: its equations and unknown parameters.
struct System<'a> {
    problem: &'a Problem,
    /// Column of each parameter within its group, or `usize::MAX` when it is fixed or unused.
    column: &'a [usize],
    equations: Vec<usize>,
    /// The parameter each column moves.
    unknowns: Vec<usize>,
    /// How columns move further parameters; `None` when each column moves its parameter alone.
    map: Option<&'a ColumnMap>,
}

/// Columns that each move a class of parameters held at fixed offsets from one another. Column `c`
/// moves `unknowns[c]` by `scale[c]` times its step, and each follower `(p, c, offset)` is then set
/// to `values[unknowns[c]] + offset`. A follower's `column` entry is its class's column, so a row
/// over several members of a class sums their derivatives, each times the scale, in that column.
struct ColumnMap {
    scale: Vec<f64>,
    followers: Vec<(usize, usize, f64)>,
}

impl System<'_> {
    /// How far a column's parameter moves per unit of its step: one without a map, so a step or
    /// derivative times it is unchanged.
    fn scale(&self, column: usize) -> f64 { self.map.map_or(1.0, |map| map.scale[column]) }

    /// Sets each follower from the parameter of its column, once those have moved.
    fn expand(&self, values: &mut [f64]) {
        let Some(map) = self.map else { return };
        for &(p, column, offset) in &map.followers { values[p] = values[self.unknowns[column]] + offset; }
    }

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
                scale: raw.iter().fold(1.0, |scale: f64, value| scale.max(value.abs())), weight: 1.0, tolerance: 0.0 };
            for (slot, &p) in equation.operands.iter().enumerate() {
                let column = self.column[p];
                if column == usize::MAX { continue; }
                // Operands one column moves, as one operand repeated in an equation, have one
                // derivative: the sum of their slots, each times how far the column moves them.
                let derivative = result.gradient[slot] * self.scale(column);
                match row.columns[..row.len].iter().position(|&c| c == column) {
                    Some(existing) => row.derivatives[existing] += derivative,
                    None => {
                        row.columns[row.len] = column;
                        row.derivatives[row.len] = derivative;
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
            let (millimetres, radians) = row.tolerances();
            let length = if row.reach > 0.0 { millimetres / row.reach } else { millimetres };
            row.tolerance = row.weight * if is_direction(equation.kind) { length.min(radians) } else { length };
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

impl Row {
    /// Accepted millimetres and direction radians: the driver tolerance, or the roundoff the
    /// coordinates allow, at the far end of the longer line for a direction.
    fn tolerances(&self) -> (f64, f64) {
        let roundoff = 8.0 * f64::EPSILON * self.scale;
        (ACCEPT_MM.max(roundoff), if self.reach > 0.0 { ACCEPT_RADIANS.max(roundoff / self.reach) } else { ACCEPT_RADIANS })
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
        let accepted = accepted(row);
        Progress {
            near: progress.near && row.residual.abs() <= NEAR * row.scale,
            accepted: progress.accepted && accepted,
            // Directions polish toward the graph checks' strict angular bound even where roundoff
            // allows acceptance, since a representable correction often exists.
            polished: progress.polished && accepted && row.millimetres <= POLISH * row.scale && row.radians <= POLISH,
        }
    })
}

fn accepted(row: &Row) -> bool {
    let (millimetres, angle) = row.tolerances();
    row.millimetres <= millimetres && row.radians <= angle
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

/// Moves the unknowns of `values` onto a solution, or as close as the iterations allow, and
/// diagnoses the equations there. The status is the worst group's; iterations are the most any
/// group took.
pub fn solve(problem: &Problem, values: &mut [f64]) -> Outcome { solve_within(problem, values, LIMITS) }

/// `solve` with other limits. A group whose factor would exceed `limits.fill` is left where it
/// is; one that spends `limits.work` stops where it got to. Either reports `TooLarge`, and
/// diagnosis is then unavailable.
pub fn solve_within(problem: &Problem, values: &mut [f64], limits: Limits) -> Outcome { solve_with(problem, values, limits, true) }

/// `solve_within` with every group solved whole, as before simple equalities were eliminated, so
/// tests can compare the two.
#[doc(hidden)]
pub fn solve_whole(problem: &Problem, values: &mut [f64], limits: Limits) -> Outcome { solve_with(problem, values, limits, false) }

/// `solve_within`, eliminating simple equalities where `eliminating` (see `eliminate`).
fn solve_with(problem: &Problem, values: &mut [f64], limits: Limits, eliminating: bool) -> Outcome {
    let (members, column) = groups(problem);
    let mut outcome = Outcome { status: Status::Converged, iterations: 0, residual: 0.0, diagnosis: Diagnosis::Diagnosed,
        degrees_of_freedom: None, labels: vec![0; problem.equations.len()], drag: None, target_distance: f64::NAN };
    // Drag targets change how every group is solved, so a problem without them is solved as before.
    let dragging = problem.equations.iter().any(|equation| equation.temporary);
    let mut squared_distance = 0.0;
    let unknowns = problem.fixed.iter().filter(|&&fixed| !fixed).count();
    if unknowns == 0 { outcome.diagnosis = Diagnosis::NoUnknowns; }
    let (mut rank, mut witnesses) = (0, Vec::new());
    // A column map the drag's landings share, so each costs its own group's size.
    let mut held = if dragging { vec![usize::MAX; problem.values.len()] } else { Vec::new() };
    // The column map of a group's classes, shared the same way.
    let mut classes = if eliminating && !dragging { vec![usize::MAX; problem.values.len()] } else { Vec::new() };
    for (equations, unknowns) in members {
        let system = System { problem, column: &column, equations, unknowns, map: None };
        let start: Vec<f64> = if dragging { Vec::new() } else { system.unknowns.iter().map(|&p| values[p]).collect() };
        // A group solved through its classes was diagnosed where it ended, as below.
        let (group, diagnosed_at_tau) = if dragging { (drag::solve_group(&system, values, limits, &mut held), None) } else {
            let rows = system.rows(values, None);
            match eliminating.then(|| eliminate::solve_group(&system, values, limits, &rows, &mut classes)).flatten() {
                Some(eliminated) => (eliminated.group, Some((eliminated.diagnosis, eliminated.spent))),
                None => (solve_group_from(&system, values, limits, MAX_ITERATIONS, rows), None),
            }
        };
        if let Some((kind, squared)) = group.drag {
            outcome.drag = Some(outcome.drag.map_or(kind, |worst| worst.max(kind)));
            squared_distance += squared;
        }
        outcome.iterations = outcome.iterations.max(group.iterations);
        // Earlier groups' largest residual with this one's, folded again if the correction moves it.
        let earlier = outcome.residual;
        let fold = |residual: f64| if earlier.is_nan() || residual.is_nan() { f64::NAN } else { earlier.max(residual) };
        outcome.residual = fold(group.residual);
        if outcome.status != Status::TooLarge && group.status != Status::Converged { outcome.status = group.status; }
        if outcome.diagnosis == Diagnosis::NoUnknowns { witnesses.extend(unmet(&system, values)); continue; }
        if outcome.diagnosis == Diagnosis::Unavailable { continue; }
        // A group accepted where it is but out of work, or too large to factor, is not diagnosed:
        // converged, it labels nothing; otherwise nothing is available.
        let Some(position) = group.position else {
            let kind = if group.status == Status::Converged { Diagnosis::Incomplete } else { Diagnosis::Unavailable };
            if kind.severity() > outcome.diagnosis.severity() { outcome.diagnosis = kind; }
            continue;
        };
        // A group that stalled short of a collapsed nearest point is diagnosed again only when its
        // rank was unclear, so a clear diagnosis is never lost to the looser distance.
        let mut work = group.work;
        // What was found within `distance`, and whether the work ran out first.
        let diagnose_at = |values: &[f64], distance, work: &mut usize| {
            let budget = limits.work.saturating_sub(*work);
            let (found, spent) = diagnose_group(&system, values, &position, distance, budget, limits.fill);
            *work = work.saturating_add(spent);
            (found, spent > budget)
        };
        // A converged group whose rank is unclear, as near a tangency, keeps the witnesses found
        // and leaves freedom unknown, and one that ran out of work while diagnosed labels nothing. A
        // group that did not converge is blamed for relations that repeat each other with values
        // that cannot agree, which conflict wherever it stopped, even where the stall itself cannot
        // be diagnosed; otherwise it is diagnosed again at `STALLED`, as rank decides whether it
        // conflicts.
        let converged = group.status == Status::Converged;
        let at_tau = match diagnosed_at_tau {
            Some((found, spent)) => { work = work.saturating_add(spent); (Some(found), false) }
            None => diagnose_at(values, TAU, &mut work),
        };
        let diagnosed = match at_tau {
            (Some(found), _) if found.2 => Some((found, Diagnosis::Diagnosed)),
            (Some(found), _) if converged => Some((found, Diagnosis::Uncertain)),
            (None, true) if converged => Some(((0, Vec::new(), false), Diagnosis::Incomplete)),
            // A drag's diagnoses fall back anyway.
            _ if group.status == Status::NotConverged => match (!dragging).then(|| repeated(&system, values, &start, limits, &mut work)).flatten() {
                Some(witnesses) => Some(((0, witnesses, false), Diagnosis::FromStart)),
                None => diagnose_at(values, STALLED, &mut work).0.filter(|found| found.2).map(|stalled| (stalled, Diagnosis::Suspected)),
            },
            _ => None,
        };
        match diagnosed {
            Some(((group_rank, group_witnesses, certain), kind)) => {
                // A solution that stands with freedom left moves toward the one nearest its start.
                // The move stands only when the group is diagnosed the same where it ends, as a
                // nearer solution can be singular; otherwise the diagnosed solution is kept.
                if !dragging && certain && converged && group_witnesses.is_empty() && group_rank < position.len() {
                    let solved: Vec<f64> = system.unknowns.iter().map(|&p| values[p]).collect();
                    let correction = nearest(&system, values, &start, &position, Limits { work: limits.work.saturating_sub(work), ..limits });
                    work = work.saturating_add(correction.work);
                    // Iterations count whether or not the correction stands.
                    outcome.iterations = outcome.iterations.max(group.iterations + correction.iterations);
                    if correction.moved {
                        let (found, _) = diagnose_group(&system, values, &position, TAU, limits.work.saturating_sub(work), limits.fill);
                        if found.is_some_and(|(found_rank, found_witnesses, found_certain)| found_certain && found_rank == group_rank && found_witnesses.is_empty()) {
                            outcome.residual = fold(worst(&system.rows(values, None)));
                        } else {
                            for (&p, &value) in system.unknowns.iter().zip(&solved) { values[p] = value; }
                        }
                    }
                }
                rank += group_rank;
                witnesses.extend(group_witnesses);
                // The most severe group decides; see `Diagnosis::severity`.
                if kind.severity() > outcome.diagnosis.severity() { outcome.diagnosis = kind; }
            }
            None => outcome.diagnosis = Diagnosis::Unavailable,
        }
    }
    if outcome.drag.is_some() { outcome.target_distance = squared_distance.sqrt(); }
    if outcome.diagnosis != Diagnosis::Unavailable {
        let tags: Vec<usize> = problem.equations.iter().map(|equation| equation.tag).collect();
        match diagnose::labels(&tags, &witnesses, limits.work) {
            Some(labels) => {
                let exact = outcome.diagnosis == Diagnosis::Diagnosed;
                outcome.degrees_of_freedom = (exact && !labels.iter().any(|&label| label & CONFLICTING != 0)).then_some(unknowns - rank);
                outcome.labels = labels;
            }
            None => outcome.diagnosis = Diagnosis::Unavailable,
        }
    }
    outcome
}

/// Rounds of `nearest`. The first ends the excess movement when the relations are linear in the
/// moved unknowns; where they bend, each round only brings the group nearer.
const NEAREST_ROUNDS: usize = 4;

/// What `nearest` did: whether it moved the group, and the work and iterations it spent.
struct Correction {
    moved: bool,
    work: usize,
    iterations: usize,
}

/// Moves a converged group with freedom left toward the solution nearest `start`, its unknowns
/// before solving. Damped Newton steps reach a solution but not the nearest one where relations
/// bend: a direction residual is a normalized sine, so its step moves a point across its line
/// rather than straight to the line it must lie on. Each round solves the linearized relations for
/// the least change from the start, `min |z|` with `J z = J (x - start) - r`, converges again from
/// `start + z`, and stands only when every row is still accepted and the group ended nearer its
/// start. That reaches the nearest solution when the relations are linear in the moved unknowns
/// and approaches it otherwise, without proving it. The rounds share `MAX_ITERATIONS`, and work
/// past `limits.work` keeps the last values that stood.
fn nearest(system: &System, values: &mut [f64], start: &[f64], position: &[usize], limits: Limits) -> Correction {
    // Distances and least change are measured per parameter, one per column.
    debug_assert!(system.map.is_none(), "the nearest solution is found with one column per parameter");
    let distance = |values: &[f64]| system.unknowns.iter().zip(start).map(|(&p, &s)| (values[p] - s).powi(2)).sum::<f64>().sqrt();
    let scale = system.unknowns.iter().zip(start).fold(1.0, |scale: f64, (&p, &s)| scale.max(values[p].abs()).max(s.abs()));
    let mut current = distance(values);
    let mut correction = Correction { moved: false, work: 0, iterations: 0 };
    let Correction { moved, work, iterations } = &mut correction;
    for _ in 0..NEAREST_ROUNDS {
        if current == 0.0 { break; }
        let rows = system.rows(values, None);
        let mut jacobian = system.jacobian(&rows, position);
        let mut offset = vec![0.0; position.len()];
        for (column, &p) in system.unknowns.iter().enumerate() { offset[position[column]] = values[p] - start[column]; }
        for (row, rhs) in &mut jacobian.rows { *rhs += row.iter().map(|&(k, derivative)| derivative * offset[k]).sum::<f64>(); }
        let Ok(Some(z)) = damped_step(&jacobian, position, f64::EPSILON * jacobian.diagonal.max(1.0), work, limits.work) else { break; };
        // A correction smaller than acceptance cannot move the group visibly nearer, and below
        // roundoff it cannot move it at all.
        let step = system.unknowns.iter().zip(start).zip(&z).map(|((&p, &s), &z)| (s + z - values[p]).powi(2)).sum::<f64>().sqrt();
        if step <= ACCEPT_MM.max(POLISH * scale) { break; }
        let saved: Vec<f64> = system.unknowns.iter().map(|&p| values[p]).collect();
        for ((&p, &s), &z) in system.unknowns.iter().zip(start).zip(&z) { values[p] = s + z; }
        let exhausted = levenberg(system, values, position, limits, work, iterations, MAX_ITERATIONS);
        let next = distance(values);
        if exhausted || !assess(&system.rows(values, None)).accepted || !(next < current) {
            for (&p, &value) in system.unknowns.iter().zip(&saved) { values[p] = value; }
            break;
        }
        current = next;
        *moved = true;
    }
    correction
}

/// Witnesses of the lasting rows of a group without unknowns that are finite and not met: each
/// conflicts by itself. A met one is left unlabelled, as there is no freedom to be redundant to.
fn unmet(system: &System, values: &[f64]) -> Vec<Witness> {
    system.rows(values, None).iter().zip(&system.equations)
        .filter(|&(row, &e)| !system.problem.equations[e].temporary && row.millimetres.is_finite() && row.radians.is_finite() && !accepted(row))
        .map(|(_, &e)| Witness { rows: vec![e], agrees: false }).collect()
}

/// The rank of a group's lasting equations at `values`, dependent within `distance`, their
/// witnesses by equation index and whether rank is certain, with the work spent.
fn diagnose_group(system: &System, values: &[f64], position: &[usize], distance: f64, budget: usize, fill: usize) -> (Option<(usize, Vec<Witness>, bool)>, usize) {
    let rows = system.rows(values, None);
    let jacobian = system.jacobian(&rows, position);
    let lasting: Vec<usize> = (0..rows.len()).filter(|&i| !system.problem.equations[system.equations[i]].temporary).collect();
    let diagnosed: Vec<diagnose::Row> = lasting.iter()
        .map(|&i| diagnose::Row { entries: jacobian.rows[i].0.clone(), residual: rows[i].residual, tolerance: rows[i].tolerance }).collect();
    let (diagnosis, spent) = diagnose(position.len(), &diagnosed, distance, budget, fill);
    (diagnosis.map(|diagnosis| (diagnosis.rank, diagnosis.witnesses.into_iter().map(|witness| Witness {
        rows: witness.rows.iter().map(|&i| system.equations[lasting[i]]).collect(), agrees: witness.agrees }).collect(), diagnosis.certain)), spent)
}

/// Witnesses of a group's lasting equations that repeat each other: rows that compute the same
/// function of the same values, up to the value each is held at and its sign (see `repeats`). Such
/// rows depend on each other at every point and their residuals combine to the same constant, so a
/// pair whose held values differ by more than both rows' tolerances at `start`, the group's
/// unknowns before solving, is a conflict wherever the sketch moves, and one that agrees a
/// repetition. Each repeat is paired with the earliest row of its function holding a value it
/// agrees with, or else with the earliest. This blames what PlaneGCS blames for repeated relations,
/// as it diagnoses the start, where a stall that collapsed or ran off cannot be diagnosed exactly.
/// Dependencies only some points show are left out: two distances to one point from two others
/// repeat each other only on their line. `None` unless some pair disagrees, or when the work would
/// pass `limits.work`.
fn repeated(system: &System, values: &[f64], start: &[f64], limits: Limits, work: &mut usize) -> Option<Vec<Witness>> {
    let problem = system.problem;
    // Each lasting equation's function: its kind and operands, a distance's points or a
    // difference's values in one order, with the value it is held at read in that order.
    let mut keyed: Vec<((usize, Vec<usize>), usize)> = system.equations.iter().copied()
        .filter(|&e| !problem.equations[e].temporary && problem.equations[e].kind != Kind::Angle)
        .map(|e| {
            let equation = &problem.equations[e];
            let operands = &equation.operands;
            let swapped: Vec<usize> = match equation.kind {
                Kind::Distance => [&operands[2..], &operands[..2]].concat(),
                Kind::Difference => vec![operands[1], operands[0]],
                _ => operands.clone(),
            };
            ((equation.kind as usize, operands.clone().min(swapped)), e)
        }).collect();
    *work = work.saturating_add(keyed.len().saturating_mul(usize::BITS as usize));
    if *work > limits.work { return None; }
    // Stable, so each function's equations stay in order.
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    let at_start = |p: usize| if system.column[p] == usize::MAX { values[p] } else { start[system.column[p]] };
    // The value an equation is held at; a kind whose residual ignores `value` is held at zero.
    let target = |e: usize| { let equation = &problem.equations[e]; if equation.kind.reads_value() { equation.value } else { 0.0 } };
    let tolerance = |e: usize| {
        let scale = problem.equations[e].operands.iter().fold(target(e).abs().max(1.0), |scale, &p| scale.max(at_start(p).abs()));
        ACCEPT_MM.max(8.0 * f64::EPSILON * scale)
    };
    let mut witnesses = Vec::new();
    for function in keyed.chunk_by(|a, b| a.0 == b.0) {
        let first = function[0].1;
        let held = |e: usize| {
            let equation = &problem.equations[e];
            if equation.kind == Kind::Difference && equation.operands != problem.equations[first].operands { -target(e) } else { target(e) }
        };
        // The earliest equation of each value held so far.
        let mut held_values = vec![first];
        for &(_, equation) in &function[1..] {
            debug_assert!(repeats(problem, &[first, equation]));
            *work = work.saturating_add(held_values.len());
            if *work > limits.work { return None; }
            let partner = held_values.iter().copied().find(|&e| (held(e) - held(equation)).abs() <= tolerance(e) + tolerance(equation));
            if partner.is_none() { held_values.push(equation); }
            let earlier = partner.unwrap_or(first);
            witnesses.push(Witness { rows: vec![earlier.min(equation), earlier.max(equation)], agrees: partner.is_some() });
        }
    }
    witnesses.iter().any(|witness| !witness.agrees).then_some(witnesses)
}

/// Whether `rows`, two or more equations, compute the same function of the same values up to the
/// value each is held at and its sign: one kind over the same operands, or a distance or a
/// difference between the same two values either way round. Angles are left out: their residuals
/// wrap by a turn, so two of them can combine at the start to nearly a turn and to nothing where
/// they hold. A zero row depends on nothing, so a witness of rows that vanish where they were
/// diagnosed is never one of these.
fn repeats(problem: &Problem, rows: &[usize]) -> bool {
    let [first, rest @ ..] = rows else { return false };
    let first = &problem.equations[*first];
    !rest.is_empty() && rest.iter().all(|&equation| {
        let equation = &problem.equations[equation];
        let (a, b) = (&equation.operands, &first.operands);
        equation.kind == first.kind && first.kind != Kind::Angle && (a == b || match equation.kind {
            Kind::Distance => a[..2] == b[2..] && a[2..] == b[..2],
            Kind::Difference => a[0] == b[1] && a[1] == b[0],
            _ => false,
        })
    })
}

/// Rows that depend on earlier lasting rows at the start stay out of a first solve, as their
/// linearizations can disagree before convergence and the seeded damped factor would then move
/// free directions by roundoff. Its result stands when every row is accepted there; otherwise
/// the group is solved again from the start with every row, sharing the iterations and work.
fn solve_group(system: &System, values: &mut [f64], limits: Limits) -> GroupOutcome { solve_group_within(system, values, limits, MAX_ITERATIONS) }

/// `solve_group` within `most` iterations.
fn solve_group_within(system: &System, values: &mut [f64], limits: Limits, most: usize) -> GroupOutcome {
    let rows = system.rows(values, None);
    solve_group_from(system, values, limits, most, rows)
}

/// `solve_group_within` with the group's `rows` at `values`.
fn solve_group_from(system: &System, values: &mut [f64], limits: Limits, most: usize, rows: Vec<Row>) -> GroupOutcome {
    let n = system.unknowns.len();
    let progress = assess(&rows);
    let finish = |rows: &[Row], progress: Progress, iterations, exhausted: bool, position, work| GroupOutcome {
        status: if progress.accepted { Status::Converged } else if exhausted { Status::TooLarge } else { Status::NotConverged },
        iterations, residual: worst(rows), position: if exhausted { None } else { position }, work, drag: None };
    let Some(ordering) = minimum_degree(n, &rows.iter().map(|row| &row.columns[..row.len]).collect::<Vec<_>>(), limits.fill, limits.work)
        else { return finish(&rows, progress, 0, true, None, limits.work); };
    if progress.polished || n == 0 { return finish(&rows, progress, 0, false, Some(ordering.position), ordering.work); }
    let (position, mut work, mut iterations) = (ordering.position, ordering.work, 0);
    let left_out = dependent_at_start(system, &rows, &position, limits, &mut work);
    if !left_out.is_empty() {
        let start: Vec<f64> = system.unknowns.iter().map(|&p| values[p]).collect();
        // A dependent row has no column of its own, so the ordering still fits.
        let mut out = left_out.iter().peekable();
        let equations = system.equations.iter().enumerate()
            .filter(|&(i, _)| if out.peek() == Some(&&i) { out.next(); false } else { true }).map(|(_, &e)| e).collect();
        let reduced = System { problem: system.problem, column: system.column, equations, unknowns: system.unknowns.clone(), map: system.map };
        let exhausted = levenberg(&reduced, values, &position, limits, &mut work, &mut iterations, most);
        let rows = system.rows(values, None);
        let progress = assess(&rows);
        if progress.accepted || exhausted { return finish(&rows, progress, iterations, exhausted, Some(position), work); }
        for (&p, &value) in system.unknowns.iter().zip(&start) { values[p] = value; }
        system.expand(values);
    }
    let exhausted = levenberg(system, values, &position, limits, &mut work, &mut iterations, most);
    let rows = system.rows(values, None);
    finish(&rows, assess(&rows), iterations, exhausted, Some(position), work)
}

/// Lasting rows of `rows` that depend on earlier ones, by index within the group, with the work
/// added to `work`. None when rank is unclear or the work would pass `limits.work`, so every row is
/// solved. Temporary targets always stay in the solve.
fn dependent_at_start(system: &System, rows: &[Row], position: &[usize], limits: Limits, work: &mut usize) -> Vec<usize> {
    let jacobian = system.jacobian(rows, position);
    let lasting: Vec<usize> = (0..rows.len()).filter(|&i| !system.problem.equations[system.equations[i]].temporary).collect();
    let entries: Vec<SparseRow> = lasting.iter().map(|&i| jacobian.rows[i].0.clone()).collect();
    let (dependent, spent) = diagnose::dependent(position.len(), &entries, limits.work.saturating_sub(*work), limits.fill);
    *work = work.saturating_add(spent);
    dependent.map_or_else(Vec::new, |dependent| dependent.into_iter().map(|i| lasting[i]).collect())
}

/// Levenberg-Marquardt from `values` until accepted at roundoff, stalled, or `iterations` reaches
/// `max_iterations`; `true` when the work passed `limits.work`.
fn levenberg(system: &System, values: &mut [f64], position: &[usize], limits: Limits, work: &mut usize, iterations: &mut usize, max_iterations: usize) -> bool {
    let mut rows = system.rows(values, None);
    let mut progress = assess(&rows);
    if progress.polished { return false; }
    let mut jacobian = system.jacobian(&rows, position);
    let diagonal = jacobian.diagonal;
    // Damping well below the smallest useful curvature during the search, and near roundoff
    // once near: a near-tangent intersection has tiny singular values that a larger floor would
    // swamp, turning Newton's quadratic convergence linear. A start that is already near polishes.
    let (floor, polish_floor) = (1e-12 * diagonal.max(1.0), f64::EPSILON * diagonal.max(1.0));
    let (mut mu, mut nu) = (if progress.near { polish_floor } else { (1e-6 * diagonal).max(floor) }, 2.0);
    let mut stagnant = 0;
    while *iterations < max_iterations {
        *iterations += 1;
        let (mut stepped, mut rejected) = (false, false);
        let Ok(step) = damped_step(&jacobian, position, mu, work, limits.work) else { return true; };
        if let Some(h) = step {
            if system.unknowns.iter().zip(&h).enumerate().all(|(column, (&p, step))| values[p] + step * system.scale(column) == values[p]) { break; }
            let saved: Vec<f64> = system.unknowns.iter().map(|&p| values[p]).collect();
            for (column, &p) in system.unknowns.iter().enumerate() { values[p] += h[column] * system.scale(column); }
            system.expand(values);
            let next = system.rows(values, Some(&rows));
            let predicted = 0.5 * h.iter().zip(&jacobian.gradient).map(|(step, gradient)| step * (mu * step - gradient)).sum::<f64>();
            let before = cost(&rows);
            let reduction = before - cost(&next);
            if reduction > 0.0 && predicted > 0.0 {
                stepped = true;
                let (rho, searching) = (reduction / predicted, !progress.near);
                // A stopping heuristic: past acceptance, a step that gains a small part of its
                // prediction and a negligible part of the cost moved only roundoff. Without it, a
                // row whose roundoff floor sits above `POLISH` keeps the loop taking such steps
                // until they vanish. The ratio keeps polishing a group whose cost is mostly a row
                // no step can reduce, accepted within tolerance: its prediction is far below the
                // cost, and a negligible part of the cost is still a real gain.
                let still = progress.accepted && rho < STAGNANT && reduction <= NEGLIGIBLE * before;
                rows = system.rows(values, None);
                progress = assess(&rows);
                stagnant = if still && progress.accepted { stagnant + 1 } else { 0 };
                if progress.polished || stagnant == 2 { break; }
                mu = if searching && progress.near { polish_floor }
                    else { (mu * (1.0 / 3.0_f64).max(1.0 - (2.0 * rho - 1.0).powi(3))).max(if progress.near { polish_floor } else { floor }) };
                nu = 2.0;
                jacobian = system.jacobian(&rows, position);
            } else {
                for (&p, &value) in system.unknowns.iter().zip(&saved) { values[p] = value; }
                system.expand(values);
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
    false
}
