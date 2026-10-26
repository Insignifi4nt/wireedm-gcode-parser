//! Drag targets. Temporary `value` rows ask for dragged coordinates; the lasting rows define where
//! the sketch may be, and the targets are approached within that set in Euclidean millimetres.
//!
//! Each trial solves a damped factor with the lasting rows weighted by `W` above the unit target
//! rows, toward the full target, its damping grown until the step is about the trust radius long.
//! Finite weights leak motion across the lasting rows, about `d / (1 + W^2 sigma^2)` for a target
//! `d` away, so `project` strips the step's part in their range until it cannot swamp the step's
//! first-order gain. The step is scaled within the trust radius and a per-row bound, then restored
//! onto the lasting rows by a few Levenberg-Marquardt iterations. A tangent step overshoots a curved
//! path, so the slopes of the squared distance at both ends of the restored path place its nearest
//! point: an overshot step is retried there, and where the nearest point lies beyond, the next step
//! goes up to four times further than the Gauss-Newton step. A trial stands when the restored point
//! is accepted, within its bounds and strictly closer to the targets, with the gain computed from
//! products so that roundoff in two nearly equal distances cannot fake it, and motion below the
//! targeted coordinates' ulps is not counted; where that hides the gain, the end slope decides
//! once the projected gradient is not small. The trust radius grows when
//! restoration was small and the path still descending, and shrinks when restoration was large. It
//! is also the continuation: the targets are approached from the start in bounded, restored steps,
//! so the result is a function of the input and follows the start's branch.
//!
//! A drag is `Reached` within `max(1e-8, 32 epsilon S)` of its targets, and lands exactly on them
//! when the lasting rows still accept that. It is `Projected` when the projected gradient is
//! within `stationary` and the curvature test (`curvature`) resolves no direction along the
//! lasting rows that gets closer to second order: the first- and second-order necessary conditions
//! on the start's branch, up to the test's resolution, not a proof of a nearest point. The test
//! counts a free direction that moves its support by no more than about its own error as held, and
//! a curved row whose multiplier is within its error and the first-order tolerance of zero as
//! carrying none, so a sketch geared past about 2^40 can hide a farthest point.
//!
//! A clearly negative curvature, as at a circle's antipode or a straight arm with a target inside
//! its reach, is followed by restored steps, halving; one that gets closer by any resolved gain
//! continues the drag. A curvature within its error of zero is followed at two lengths too, along
//! the flat direction that moves the targets most. Finding nothing closer leaves the drag projected
//! when no flat direction moves a target, as a free part the targets do not reach; otherwise higher
//! orders decide, so that stalls.
//! Anything else, including a curvature test that cannot decide, is `Stalled`, at the last
//! feasible values. Restoring the start, the trials with their restorations and a
//! landing's polish share `DRAG_ITERATIONS`, and a check the budget cut short decides nothing.

use super::{Exhausted, GroupOutcome, Jacobian, Limits, MAX_ITERATIONS, System, assess, levenberg, solve_group as solve_whole, solve_group_within, worst};
use crate::equations::Kind;
use crate::problem::Status;
use crate::sparse::{Factor, minimum_degree};

mod curvature;
use curvature::Curvature;

/// How a group's drag targets ended; later variants are worse.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum DragOutcome {
    /// Within `max(1e-8, 32 epsilon S)` millimetres of every target.
    Reached = 0,
    /// Nothing closer found from this start: the projected gradient is small and the curvature
    /// test resolves no direction along the lasting rows that gets closer to second order. A
    /// necessary condition up to the test's resolution, not a proof of the nearest point.
    Projected = 1,
    /// Neither within the iterations allowed; the values are the last feasible ones.
    Stalled = 2,
}

/// Weight of the lasting rows above the unit target rows in a tangent step.
const W: f64 = 1e6;
/// Damping of a tangent step, on the target rows' unit scale: it keeps directions that neither the
/// targets nor the lasting rows decide still, and stays far below `W^2 sigma^2` of any lasting
/// direction whose rank is reliable.
const MU: f64 = 1e-6;
/// Most damped solves for one tangent step.
const DAMPING_PASSES: usize = 4;
/// Levenberg-Marquardt iterations restoring one trial onto the lasting rows.
const RESTORE_ITERATIONS: usize = 8;
/// Most step lengths, halving, tried along a direction of negative curvature.
const DESCENT_LENGTHS: usize = 7;
/// Step lengths, halving, tried along a flat direction before it is taken as flat.
const FLAT_LENGTHS: usize = 2;
/// Most iterations of one group's drag: restoring its start, its trials with their restorations,
/// and polishing a landing, together. A restored trial takes about four.
pub const DRAG_ITERATIONS: usize = 4 * MAX_ITERATIONS;
/// Most projection passes for a tangent step or a stationarity check; each shrinks the range
/// part by `1 + W^2 sigma^2`.
const PROJECTION_PASSES: usize = 3;

/// A target row: the dragged parameter, its column and the requested value.
struct Target { parameter: usize, column: usize, value: f64 }

/// A nonlinear lasting row's unknown columns and how far one step may move each.
struct Bound { columns: Vec<usize>, limit: f64 }

/// What a drag does where gains no longer resolve progress: done, moved closer by a step of the
/// given length, or still moving.
enum Settled { Done(DragOutcome), Moved(f64), Moving }

/// A restored trial step, left in the values until it is kept or undone.
struct Trial {
    /// Restored onto the lasting rows, within its bounds.
    within: bool,
    /// Cut short by the iteration budget and not restored.
    unfinished: bool,
    /// Reduction of the squared target distance, from products.
    gain: f64,
    /// Roundoff in `gain`.
    roundoff: f64,
    /// Smallest gain the main loop counts as progress, beyond `roundoff`.
    floor: f64,
    /// Norm of the restoration's own displacement.
    restoration: f64,
    /// Derivative of the squared distance along the step at the restored point, with the step
    /// projected along the lasting rows there; not a number when the trial is not within.
    slope: f64,
    saved: Vec<f64>,
}

impl Trial {
    /// Closer by a gain the main loop counts as progress.
    fn closer(&self) -> bool { self.within && self.gain > self.roundoff + self.floor }

    /// Closer by any gain beyond roundoff, along a direction the curvature test found descending.
    fn resolved(&self) -> bool { self.within && self.gain > self.roundoff }
}

/// Length that bounds a step of the operands `o` of a row that is nonlinear in its unknowns (`free`):
/// a distance's span, a movable guide line, or the shorter movable line of a direction or
/// equal-length pair, which a longer step could turn over. `None` for rows linear in their
/// unknowns, which no step size can take to another branch: a point on a fixed guide, for one.
fn row_length(kind: Kind, o: &[f64], free: &[bool]) -> Option<f64> {
    let length = |x: f64, y: f64| (x * x + y * y).sqrt();
    let movable = |first: usize| free[first..first + 4].iter().any(|&free| free);
    let line = |first: usize| movable(first).then(|| length(o[first + 2] - o[first], o[first + 3] - o[first + 1]));
    match kind {
        Kind::Difference | Kind::Value | Kind::Midpoint => None,
        // Between two fixed points a distance is a constant, or minus a free radius: linear.
        Kind::Distance | Kind::DistanceToParameter => movable(0).then(|| length(o[2] - o[0], o[3] - o[1])),
        Kind::PointOnLine => line(2),
        Kind::Parallel | Kind::Perpendicular | Kind::Angle | Kind::EqualLength => [line(0), line(4)].into_iter().flatten().reduce(f64::min),
        Kind::SymmetricMidpoint | Kind::SymmetricPerpendicular => line(4),
    }
}

fn norm(values: &[f64]) -> f64 { values.iter().map(|value| value * value).sum::<f64>().sqrt() }

/// Solves a group of a problem with drag targets. A group without targets whose start is accepted
/// is not iterated, so it keeps its values exactly; one that is not accepted is solved as usual.
pub(super) fn solve_group(system: &System, values: &mut [f64], limits: Limits) -> GroupOutcome {
    let problem = system.problem;
    let lasting = System { problem, column: system.column,
        equations: system.equations.iter().copied().filter(|&e| !problem.equations[e].temporary).collect(), unknowns: system.unknowns.clone() };
    let targets: Vec<Target> = system.equations.iter().map(|&e| &problem.equations[e]).filter(|equation| equation.temporary)
        .map(|equation| Target { parameter: equation.operands[0], column: system.column[equation.operands[0]], value: equation.value }).collect();
    let n = system.unknowns.len();
    let rows = lasting.rows(values, None);
    let squared = |values: &[f64]| targets.iter().map(|target| (values[target.parameter] - target.value).powi(2)).sum::<f64>();
    let scale = targets.iter().fold(1.0, |scale: f64, target| scale.max(values[target.parameter].abs()).max(target.value.abs()));
    let reached = 1e-8_f64.max(32.0 * f64::EPSILON * scale);
    if targets.is_empty() && !assess(&rows).accepted { return solve_whole(system, values, limits); }
    let Some(ordering) = minimum_degree(n, &system.rows(values, None).iter().map(|row| &row.columns[..row.len]).collect::<Vec<_>>(), limits.fill, limits.work)
        else { return GroupOutcome { status: Status::TooLarge, iterations: 0, residual: worst(&rows), position: None, work: limits.work,
            drag: (!targets.is_empty()).then(|| (DragOutcome::Stalled, squared(values))) }; };
    let accepted = |rows| if assess(rows).accepted { Status::Converged } else { Status::NotConverged };
    if targets.is_empty() || n == 0 {
        // Untouched by the drag, or with only fixed targets, which count toward the distance but never move.
        let distance = squared(values);
        let drag = (!targets.is_empty()).then(|| (if distance.sqrt() <= reached { DragOutcome::Reached } else { DragOutcome::Projected }, distance));
        return GroupOutcome { status: accepted(&rows), iterations: 0, residual: worst(&rows), position: Some(ordering.position), work: ordering.work, drag };
    }
    // Half the work is kept for diagnosis.
    let mut drag = Drag { lasting: &lasting, targets: &targets, position: ordering.position, limits: Limits { fill: limits.fill, work: limits.work / 2 },
        work: ordering.work, iterations: 0, reached, stationary: 1e-9_f64.max(64.0 * f64::EPSILON * scale),
        floor: 1e-6_f64.max(64.0 * f64::EPSILON * scale) };
    let outcome = if assess(&rows).accepted { drag.run(values) } else {
        // An infeasible start is first restored onto the lasting rows.
        let restored = solve_group_within(&lasting, values, drag.limits, MAX_ITERATIONS);
        drag.work = drag.work.saturating_add(restored.work);
        drag.iterations += restored.iterations;
        match restored.status { Status::Converged => drag.run(values), Status::TooLarge => Err(Exhausted), _ => Ok(DragOutcome::Stalled) }
    };
    let rows = lasting.rows(values, None);
    let (status, position) = match outcome {
        // A stalled drag still stands at feasible values when the lasting rows accept them.
        Ok(_) => (accepted(&rows), Some(drag.position)),
        Err(Exhausted) => (Status::TooLarge, None),
    };
    GroupOutcome { status, iterations: drag.iterations, residual: worst(&rows), position, work: drag.work,
        drag: Some((outcome.unwrap_or(DragOutcome::Stalled), squared(values))) }
}

struct Drag<'a> {
    lasting: &'a System<'a>,
    targets: &'a [Target],
    position: Vec<usize>,
    limits: Limits,
    work: usize,
    iterations: usize,
    /// Distance within which the targets are reached.
    reached: f64,
    /// Projected gradient norm counted as stationary.
    stationary: f64,
    /// Smallest step bound and trust radius, at the targets' scale.
    floor: f64,
}

impl Drag<'_> {
    /// Each target's residual, its value less the requested one.
    fn residual(&self, values: &[f64]) -> Vec<f64> { self.targets.iter().map(|target| values[target.parameter] - target.value).collect() }

    fn run(&mut self, values: &mut [f64]) -> Result<DragOutcome, Exhausted> {
        let distance = norm(&self.residual(values));
        // The local size of the geometry the targets pull on; a target held only by linear rows
        // or by nothing is reached in one step.
        let support = self.bounds(values).iter().filter(|bound| self.targets.iter().any(|target| bound.columns.contains(&target.column)))
            .map(|bound| 2.0 * bound.limit).reduce(f64::min);
        let mut radius = support.map_or(distance, |support| distance.min(0.25 * support)).max(self.floor);
        // How many Gauss-Newton steps the next step may take, from the last secant.
        let mut stretch = 1.0_f64;
        while self.iterations < DRAG_ITERATIONS {
            let r = self.residual(values);
            let distance = norm(&r);
            if distance <= self.reached && self.land(values)? { return Ok(DragOutcome::Reached); }
            let goal: Vec<f64> = self.targets.iter().map(|target| target.value).collect();
            let step = match radius > self.floor * 1e-6 { true => self.tangent(values, &goal, radius)?, false => None }.map(|h| {
                let gauss = norm(&h);
                let alpha = stretch.min(radius / gauss).min(self.bounded(values, &h));
                (h.iter().map(|value| alpha * value).collect::<Vec<f64>>(), gauss)
            }).filter(|(step, _)| self.lasting.unknowns.iter().zip(step).any(|(&p, value)| values[p] + value != values[p]));
            let Some((step, gauss)) = step else {
                // No step moves anything: reached short of an exact landing, stationary, or stalled.
                match self.settle(values)? {
                    Settled::Moved(length) => { radius = length; continue; }
                    Settled::Done(outcome) => return Ok(outcome),
                    Settled::Moving => return Ok(DragOutcome::Stalled),
                }
            };
            let length = norm(&step);
            // The squared distance falls at `first` per unit of the step at its start.
            let first = -2.0 * self.targets.iter().zip(&r).map(|(target, r)| r * step[target.column]).sum::<f64>();
            let trial = self.trial(values, &step, radius, &r)?;
            if !trial.within { self.undo(values, &trial.saved); radius = 0.5 * radius.min(length); continue; }
            // A secant on the slopes: a tangent step overshoots a curved path by about the target's
            // distance over the path's radius of curvature, and once the path has passed its nearest
            // point that lies `first / (first + slope)` of the way. Overshot steps retry there.
            let best = if trial.slope > 0.0 { first / (first + trial.slope) } else { f64::INFINITY };
            let (trial, first, length) = if first > 0.0 && best < 0.8 && self.iterations < DRAG_ITERATIONS {
                self.undo(values, &trial.saved);
                let scale = best;
                let retry: Vec<f64> = step.iter().map(|value| scale * value).collect();
                radius = scale * length;
                (self.trial(values, &retry, radius, &r)?, scale * first, scale * length)
            } else { (trial, first, length) };
            if !trial.within || first <= 0.0 || trial.gain < -(trial.roundoff + trial.floor) {
                self.undo(values, &trial.saved);
                radius = 0.5 * radius.min(length);
                continue;
            }
            if trial.closer() {
                // Where the path is flatter than the Gauss-Newton model, as near a far target, or
                // curves away, as off a farthest point, the secant places the nearest point beyond
                // the step: the next step goes that many Gauss-Newton steps, at most four times this one.
                let secant = if trial.slope < 0.0 && first + trial.slope > 0.0 { first / (first + trial.slope) } else if trial.slope < 0.0 { f64::INFINITY } else { 1.0 };
                stretch = (length / gauss * secant.min(4.0)).max(1.0);
                let q = trial.restoration / length;
                if q > 0.5 { radius = 0.5 * radius.min(length); }
                else if trial.slope <= 0.0 && q <= 0.1 && length >= 0.5 * radius { radius *= 2.0; }
                continue;
            }
            // The gains no longer resolve progress: the projected gradient at the trial point
            // decides, then whether the slopes still fell, which resolve progress where the gains
            // cannot, as when the targets are far from the moving coordinates.
            match self.settle(values)? {
                Settled::Moved(length) => radius = length,
                Settled::Done(outcome) => return Ok(outcome),
                Settled::Moving if trial.slope <= 0.25 * first => { if trial.slope <= 0.0 && length >= 0.5 * radius { radius *= 2.0; } }
                Settled::Moving => { self.undo(values, &trial.saved); radius = 0.5 * radius.min(length); }
            }
        }
        Ok(if norm(&self.residual(values)) <= self.reached { DragOutcome::Reached } else { DragOutcome::Stalled })
    }

    /// Where progress can no longer be measured by gains: `Done` when the targets are reached, or
    /// projected with the curvature test resolving nothing closer; `Moved` when a step along a
    /// negative curvature got closer; `Moving` when the projected gradient is not small.
    /// A test that cannot decide, or a negative curvature no step can follow, stalls the drag.
    fn settle(&mut self, values: &mut [f64]) -> Result<Settled, Exhausted> {
        let r = self.residual(values);
        if norm(&r) <= self.reached { return Ok(Settled::Done(DragOutcome::Reached)); }
        if !self.stationary(values, &r)? { return Ok(Settled::Moving); }
        match self.curvature(values, &r)? {
            Curvature::Clear => Ok(Settled::Done(DragOutcome::Projected)),
            Curvature::Unresolved => Ok(Settled::Done(DragOutcome::Stalled)),
            Curvature::Negative { direction, theta } => self.descend(values, &r, &direction, Some(theta)),
            Curvature::Flat { direction, still } => match self.descend(values, &r, &direction, None)? {
                Settled::Done(DragOutcome::Projected) if !still => Ok(Settled::Done(DragOutcome::Stalled)),
                settled => Ok(settled),
            },
        }
    }

    /// Restored steps along a unit direction of negative curvature `theta`, from the rows' bound
    /// and halving, first the way the gradient does not climb; the first that gets closer stands,
    /// and without one the drag stalls. Along a flat direction (`None`), where orders past the
    /// second decide, `FLAT_LENGTHS` lengths are tried; finding nothing closer leaves the second-order
    /// necessary condition met, so that is projected, unless the caller knows higher orders decide.
    fn descend(&mut self, values: &mut [f64], r: &[f64], direction: &[f64], theta: Option<f64>) -> Result<Settled, Exhausted> {
        let climb: f64 = self.targets.iter().zip(r).map(|(target, r)| r * direction[target.column]).sum();
        let first = if climb > 0.0 { -1.0 } else { 1.0 };
        let mut length = self.bounded(values, direction).min(norm(r));
        for _ in 0..theta.map_or(FLAT_LENGTHS, |_| DESCENT_LENGTHS) {
            // A gain the products cannot resolve is not worth a trial.
            if let Some(theta) = theta && !(-theta * length * length > 8.0 * f64::EPSILON * norm(r) * length) { break; }
            for sign in [first, -first] {
                if self.iterations >= DRAG_ITERATIONS { return Ok(Settled::Done(DragOutcome::Stalled)); }
                let step: Vec<f64> = direction.iter().map(|value| sign * length * value).collect();
                let trial = self.trial(values, &step, length, r)?;
                if trial.resolved() { return Ok(Settled::Moved(length)); }
                self.undo(values, &trial.saved);
                if trial.unfinished { return Ok(Settled::Done(DragOutcome::Stalled)); }
            }
            length *= 0.5;
        }
        Ok(Settled::Done(if theta.is_none() { DragOutcome::Projected } else { DragOutcome::Stalled }))
    }

    /// Writes the targets exactly when the lasting rows still accept them. Landing moves the targeted
    /// coordinates by up to the reach distance, so the other unknowns are then polished with the
    /// targets held, as a solve without targets would polish them; a polish that is not accepted is
    /// undone, leaving the landing accepted as it was.
    fn land(&mut self, values: &mut [f64]) -> Result<bool, Exhausted> {
        let saved: Vec<f64> = self.targets.iter().map(|target| values[target.parameter]).collect();
        for target in self.targets { values[target.parameter] = target.value; }
        if !assess(&self.lasting.rows(values, None)).accepted {
            for (target, &value) in self.targets.iter().zip(&saved) { values[target.parameter] = value; }
            return Ok(false);
        }
        let unknowns: Vec<usize> = self.lasting.unknowns.iter().copied()
            .filter(|&p| !self.targets.iter().any(|target| target.parameter == p)).collect();
        if unknowns.is_empty() { return Ok(true); }
        let mut column = vec![usize::MAX; values.len()];
        for (c, &p) in unknowns.iter().enumerate() { column[p] = c; }
        let held = System { problem: self.lasting.problem, column: &column, equations: self.lasting.equations.clone(), unknowns };
        let saved: Vec<f64> = held.unknowns.iter().map(|&p| values[p]).collect();
        let limits = Limits { fill: self.limits.fill, work: self.limits.work.saturating_sub(self.work) };
        let polished = solve_group_within(&held, values, limits, DRAG_ITERATIONS.saturating_sub(self.iterations).min(MAX_ITERATIONS));
        self.work = self.work.saturating_add(polished.work);
        self.iterations += polished.iterations;
        match polished.status {
            Status::Converged => {}
            Status::TooLarge => {
                // The landing stands; the polish's partial work is not accepted.
                for (&p, &value) in held.unknowns.iter().zip(&saved) { values[p] = value; }
                return Err(Exhausted);
            }
            _ => for (&p, &value) in held.unknowns.iter().zip(&saved) { values[p] = value; },
        }
        Ok(true)
    }

    fn undo(&self, values: &mut [f64], saved: &[f64]) {
        for (&p, &value) in self.lasting.unknowns.iter().zip(saved) { values[p] = value; }
    }

    /// Bounds of the nonlinear lasting rows at `values`: half each row's length, at least `floor`.
    fn bounds(&self, values: &[f64]) -> Vec<Bound> {
        let problem = self.lasting.problem;
        self.lasting.equations.iter().filter_map(|&e| {
            let equation = &problem.equations[e];
            let operands: Vec<f64> = equation.operands.iter().map(|&p| values[p]).collect();
            let free: Vec<bool> = equation.operands.iter().map(|&p| self.lasting.column[p] != usize::MAX).collect();
            let length = row_length(equation.kind, &operands, &free)?;
            let columns: Vec<usize> = equation.operands.iter().map(|&p| self.lasting.column[p]).filter(|&c| c != usize::MAX).collect();
            Some(Bound { columns, limit: (0.5 * length).max(self.floor) })
        }).collect()
    }

    /// The largest scale of `step` that keeps every row within its bound.
    fn bounded(&self, values: &[f64], step: &[f64]) -> f64 {
        self.bounds(values).iter().fold(f64::INFINITY, |alpha: f64, bound| {
            let largest = bound.columns.iter().fold(0.0, |largest: f64, &c| largest.max(step[c].abs()));
            if largest > 0.0 { alpha.min(bound.limit / largest) } else { alpha }
        })
    }

    fn factor(&self, mu: f64) -> Factor { Factor::damped(self.position.len(), mu, self.limits.work.saturating_sub(self.work)) }

    /// Rotates `rows` into `factor`, counting the work; `Err` when it runs out.
    fn rotate(&mut self, mut factor: Factor, rows: impl IntoIterator<Item = (Vec<(usize, f64)>, f64)>) -> Result<Factor, Exhausted> {
        let finished = rows.into_iter().all(|(row, rhs)| factor.rotate(row, rhs));
        self.work = self.work.saturating_add(factor.work);
        if finished { Ok(factor) } else { Err(Exhausted) }
    }

    fn jacobian(&self, values: &[f64]) -> Jacobian { self.lasting.jacobian(&self.lasting.rows(values, None), &self.position) }

    /// A step toward `goal` along the lasting rows, by column; `None` when it is not finite. When
    /// the Gauss-Newton step is longer than `radius` the damping grows until it is about that long,
    /// turning it toward the projected gradient: a nearly singular map from the free directions to
    /// the targets, as of an arm nearly straight, otherwise sends a cut-down step sideways.
    fn tangent(&mut self, values: &[f64], goal: &[f64], radius: f64) -> Result<Option<Vec<f64>>, Exhausted> {
        let jacobian = self.jacobian(values);
        let weighted: Vec<(Vec<(usize, f64)>, f64)> = jacobian.rows.iter().map(|(row, rhs)| (row.iter().map(|&(k, v)| (k, W * v)).collect(), W * rhs)).collect();
        let pulls: Vec<(Vec<(usize, f64)>, f64)> = self.targets.iter().zip(goal).map(|(target, &goal)| (vec![(self.position[target.column], 1.0)], goal - values[target.parameter])).collect();
        // The inverse of the step's length is nearly linear in the damping (Moré), so a secant on
        // it finds the damping for a step about `radius` long.
        let (mut mu, mut last) = (MU, None);
        let mut step = None;
        for pass in 0..DAMPING_PASSES {
            let factor = self.rotate(self.factor(mu), weighted.iter().chain(&pulls).cloned())?;
            let Some(x) = factor.solve() else { return Ok(None); };
            let h: Vec<f64> = self.position.iter().map(|&k| x[k]).collect();
            // Measured once its leak across the lasting rows is gone: a far target's pull leaks
            // about its distance over `W^2`, which can dwarf the step along them.
            let Some((h, removed)) = self.project(&jacobian, &h)? else { return Ok(None); };
            let length = norm(&h);
            step = Some((h, removed));
            if !(length > 1.5 * radius) && (pass == 0 || length >= 0.5 * radius) { break; }
            let next = match last {
                // Past the targets' own scale the step's length falls about as `1 / mu`.
                None => mu.max(1.0) * length / radius,
                Some((before, inverse)) => mu + (1.0 / radius - 1.0 / length) * (mu - before) / (1.0 / length - inverse),
            };
            if !(next.is_finite() && next > 0.0) { break; }
            last = Some((mu, 1.0 / length));
            mu = next;
        }
        // What is left across the lasting rows shrinks by `W^2` a pass; against a far target it would
        // still swamp the step's first-order gain, which is about its length times the projected
        // gradient.
        let Some((mut step, mut removed)) = step else { return Ok(None); };
        for _ in 1..PROJECTION_PASSES {
            if removed <= 1e-3 * f64::EPSILON * norm(&step) { break; }
            let Some(next) = self.project(&jacobian, &step)? else { return Ok(None); };
            (step, removed) = next;
        }
        Ok(Some(step))
    }

    /// `(I + W^2 J^T J)^-1 z` for the lasting rows' `J`, with the norm of what it removed: `z`'s part
    /// along their null space is kept exactly, and the rest shrinks by at least `1 + W^2 sigma^2`.
    /// `y` minimizes `|W J y - W J z|^2 + |y|^2`, and the result is `z - y`.
    fn project(&mut self, jacobian: &Jacobian, z: &[f64]) -> Result<Option<(Vec<f64>, f64)>, Exhausted> { self.project_rows(&jacobian.rows, z) }

    /// `project` along the null space of `rows`, given by factor position.
    fn project_rows(&mut self, rows: &[(Vec<(usize, f64)>, f64)], z: &[f64]) -> Result<Option<(Vec<f64>, f64)>, Exhausted> {
        let mut by_position = vec![0.0; z.len()];
        for (column, &k) in self.position.iter().enumerate() { by_position[k] = z[column]; }
        let rows: Vec<_> = rows.iter().map(|(row, _)| {
            let along = row.iter().map(|&(k, v)| v * by_position[k]).sum::<f64>();
            (row.iter().map(|&(k, v)| (k, W * v)).collect(), W * along)
        }).collect();
        let factor = self.rotate(self.factor(1.0), rows)?;
        let Some(y) = factor.solve() else { return Ok(None); };
        let removed: Vec<f64> = self.position.iter().map(|&k| y[k]).collect();
        Ok(Some((z.iter().zip(&removed).map(|(z, y)| z - y).collect(), norm(&removed))))
    }

    /// Whether the projected gradient of the target distance is within `stationary`, roundoff aside.
    /// Each pass leaves the gradient's null-space part `P g` exactly and an orthogonal remainder in
    /// the lasting rows' range, so the norm bounds `|P g|` from above and a leak can only fail the test.
    fn stationary(&mut self, values: &[f64], r: &[f64]) -> Result<bool, Exhausted> {
        let jacobian = self.jacobian(values);
        let mut z = vec![0.0; self.position.len()];
        for (target, &r) in self.targets.iter().zip(r) { z[target.column] += r; }
        for _ in 0..PROJECTION_PASSES {
            let Some((next, removed)) = self.project(&jacobian, &z)? else { return Ok(false); };
            z = next;
            if removed <= 0.1 * self.stationary { break; }
        }
        Ok(norm(&z) <= self.stationary)
    }

    /// Takes `step` and restores the lasting rows, leaving the result in `values`. It is within its
    /// bounds when accepted, each row's operands moved within its bound and no unknown restored by
    /// more than `radius`. Exhausted work restores the start.
    fn trial(&mut self, values: &mut [f64], step: &[f64], radius: f64, r: &[f64]) -> Result<Trial, Exhausted> {
        let unknowns = &self.lasting.unknowns;
        let saved: Vec<f64> = unknowns.iter().map(|&p| values[p]).collect();
        if self.iterations >= DRAG_ITERATIONS {
            return Ok(Trial { within: false, unfinished: true, gain: 0.0, roundoff: 0.0, floor: 0.0, restoration: 0.0, slope: f64::NAN, saved });
        }
        let bounds = self.bounds(values);
        for (&p, value) in unknowns.iter().zip(step) { values[p] += value; }
        let stepped: Vec<f64> = unknowns.iter().map(|&p| values[p]).collect();
        // The trial counts as one iteration and its restoration takes at most what is left.
        self.iterations += 1;
        let allowed = RESTORE_ITERATIONS.min(DRAG_ITERATIONS.saturating_sub(self.iterations));
        let mut iterations = 0;
        let exhausted = levenberg(self.lasting, values, &self.position, self.limits, &mut self.work, &mut iterations, allowed);
        self.iterations += iterations;
        if exhausted { self.undo(values, &saved); return Err(Exhausted); }
        let moved: Vec<f64> = unknowns.iter().zip(&saved).map(|(&p, start)| values[p] - start).collect();
        let restoration: Vec<f64> = unknowns.iter().zip(&stepped).map(|(&p, stepped)| values[p] - stepped).collect();
        let accepted = assess(&self.lasting.rows(values, None)).accepted;
        let within = accepted
            && restoration.iter().all(|value| value.abs() <= radius)
            && bounds.iter().all(|bound| bound.columns.iter().all(|&c| moved[c].abs() <= bound.limit));
        // |r|^2 - |r + E dx|^2 from products, so roundoff in two nearly equal distances cannot fake it.
        // The displacements are differences of the values themselves and each residual is rounded
        // to its own size, so the gain is resolved to a few ulps of `|r| |E dx|`. For the main loop,
        // motion of the targeted coordinates below a few ulps of their own size, at least a
        // millimetre, is not progress: it is the slack the lasting rows accept, whatever the
        // targets' size. A step along a negative curvature counts any resolved gain.
        let coordinates = self.targets.iter().map(|target| values[target.parameter].abs().max(saved[target.column].abs())).fold(1.0, f64::max);
        let (along, squared) = self.targets.iter().zip(r).fold((0.0, 0.0), |(along, squared), (target, &r)|
            (along + r * moved[target.column], squared + moved[target.column] * moved[target.column]));
        // The path's direction at its end is the step projected along the lasting rows there, which
        // still bends with them when the restoration itself is below the coordinates' ulps.
        let direction = match within {
            true => { let jacobian = self.jacobian(values); self.project(&jacobian, step) }
            false => Ok(None),
        };
        let Ok(direction) = direction else { self.undo(values, &saved); return Err(Exhausted); };
        let slope = direction.map_or(f64::NAN, |(direction, _)| 2.0 * self.targets.iter().map(|target| (values[target.parameter] - target.value) * direction[target.column]).sum::<f64>());
        Ok(Trial { within, unfinished: !accepted && iterations == allowed && allowed < RESTORE_ITERATIONS, gain: -2.0 * along - squared, roundoff: 8.0 * f64::EPSILON * norm(r) * squared.sqrt(),
            floor: 8.0 * f64::EPSILON * norm(r) * coordinates,
            restoration: norm(&restoration), slope, saved })
    }
}
