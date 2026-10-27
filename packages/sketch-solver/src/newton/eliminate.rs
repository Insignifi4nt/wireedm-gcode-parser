//! Exact elimination of simple equalities before a group's first solve.
//!
//! A difference `b - a = v` between two unknowns holds them at a fixed offset, so they move as one
//! class, and a value, or a difference with a fixed parameter, pins a class where it holds. Each
//! class a remaining row reads is one column of a smaller system (see `ColumnMap`), scaled by one
//! over the square root of its size so a step moves the class as far as it moves the column. The
//! smaller system is solved from the nearest start that meets the eliminated rows, then expanded
//! and diagnosed whole, where solving the whole group would have diagnosed it.
//!
//! Only a group whose rows are all linear, differences, values and midpoints, is solved this way.
//! Each damped step of either solve lies in the span of its rows' gradients, so where the rows can
//! hold, both end at the solution nearest the start: the projection is nearest on the eliminated
//! rows, and the scaling makes the smaller system measure distance as the whole group does. Rows
//! are weighted by their own gradients in the smaller system, which changes the path but not where
//! it ends. A group with a bent row can have several separate solutions, and the two solves can
//! reach different ones, so it is solved whole from its start, as before; so are a drag, a start
//! already polished, a constant row that is not met, and a smaller solve or diagnosis that falls
//! short.

use super::{ColumnMap, GroupOutcome, Limits, MAX_ITERATIONS, Row, System, accepted, assess, diagnose_group, solve_group_within, worst};
use crate::diagnose::{TAU, Witness};
use crate::equations::Kind;
use crate::problem::Status;
use crate::sparse::minimum_degree;

const NONE: usize = usize::MAX;

/// A group solved through its classes, with the whole group's diagnosis at `TAU` where it ended
/// and the work that diagnosis spent.
pub(super) struct Eliminated {
    pub(super) group: GroupOutcome,
    pub(super) diagnosis: (usize, Vec<Witness>, bool),
    pub(super) spent: usize,
}

/// What an equation of the group became.
#[derive(Clone, Copy, PartialEq)]
enum Role {
    /// Joined two classes or pinned one, so it holds by construction.
    Eliminated,
    /// Reads no free class, so it holds or not wherever the classes move.
    Constant,
    /// Left to solve.
    Kept,
}

/// Classes of a group's unknowns, by column within the group.
struct Classes {
    root: Vec<usize>,
    /// `values[unknowns[i]] = values[unknowns[root[i]]] + offset[i]`, zero at a root.
    offset: Vec<f64>,
    /// The next member of the class, `NONE` after the last.
    next: Vec<usize>,
    /// At a root: the last member and the size of its class.
    last: Vec<usize>,
    size: Vec<usize>,
}

impl Classes {
    fn new(n: usize) -> Classes {
        Classes { root: (0..n).collect(), offset: vec![0.0; n], next: vec![NONE; n], last: (0..n).collect(), size: vec![1; n] }
    }

    fn members(&self, root: usize) -> impl Iterator<Item = usize> + '_ {
        std::iter::successors(Some(root), |&i| (self.next[i] != NONE).then_some(self.next[i]))
    }

    /// Joins the classes of roots `a` and `b`, where `x[b] = x[a] + d`. The smaller class takes the
    /// other's root, so a member is relabelled at most `log2 n` times.
    fn join(&mut self, a: usize, b: usize, d: f64) {
        let (kept, moved, shift) = if self.size[a] >= self.size[b] { (a, b, d) } else { (b, a, -d) };
        let mut i = moved;
        while i != NONE {
            self.root[i] = kept;
            self.offset[i] += shift;
            i = self.next[i];
        }
        self.next[self.last[kept]] = moved;
        self.last[kept] = self.last[moved];
        self.size[kept] += self.size[moved];
    }
}

/// Solves a group through the classes its simple equalities hold, from `values` with the group's
/// `rows` there, or leaves `values` exactly as they were and returns `None` when it must be solved
/// whole. `scratch` is a problem-wide column map of `NONE`, left as it was.
pub(super) fn solve_group(system: &System, values: &mut [f64], limits: Limits, rows: &[Row], scratch: &mut [usize]) -> Option<Eliminated> {
    let problem = system.problem;
    let (n, column) = (system.unknowns.len(), system.column);
    let equations: Vec<_> = system.equations.iter().map(|&e| &problem.equations[e]).collect();
    if n == 0 || !equations.iter().any(|equation| matches!(equation.kind, Kind::Difference | Kind::Value))
        || !equations.iter().all(|equation| !equation.temporary && matches!(equation.kind, Kind::Difference | Kind::Value | Kind::Midpoint)) { return None; }
    // Solving it whole takes no step from a polished start.
    if assess(rows).polished { return None; }

    let mut classes = Classes::new(n);
    let mut role = vec![Role::Kept; equations.len()];
    for (index, equation) in equations.iter().enumerate() {
        if equation.kind != Kind::Difference { continue; }
        let (a, b) = (column[equation.operands[0]], column[equation.operands[1]]);
        if a == NONE || b == NONE { continue; }
        let (ra, rb) = (classes.root[a], classes.root[b]);
        role[index] = if ra == rb { Role::Constant } else {
            // `x[b] = x[a] + v`, so `x[rb] = x[ra] + offset[a] + v - offset[b]`.
            classes.join(ra, rb, classes.offset[a] + equation.value - classes.offset[b]);
            Role::Eliminated
        };
    }
    // The value at which a pinned class holds its root; a later pin of the class is constant.
    let mut pin: Vec<Option<f64>> = vec![None; n];
    for (index, equation) in equations.iter().enumerate() {
        let operands = &equation.operands;
        let (member, value) = match equation.kind {
            Kind::Value => (column[operands[0]], equation.value),
            Kind::Difference if column[operands[0]] == NONE => (column[operands[1]], values[operands[0]] + equation.value),
            Kind::Difference if column[operands[1]] == NONE => (column[operands[0]], values[operands[1]] - equation.value),
            _ => continue,
        };
        let root = classes.root[member];
        role[index] = if pin[root].is_some() { Role::Constant } else {
            pin[root] = Some(value - classes.offset[member]);
            Role::Eliminated
        };
    }
    // A free class is one column of the reduced system when a row left reads it; a row that reads
    // none is constant.
    let free = |p: usize| column[p] != NONE && pin[classes.root[column[p]]].is_none();
    let mut read = vec![false; n];
    for (index, equation) in equations.iter().enumerate() {
        if role[index] != Role::Kept { continue; }
        for &p in &equation.operands { if free(p) { read[classes.root[column[p]]] = true; } }
        if !equation.operands.iter().any(|&p| free(p)) { role[index] = Role::Constant; }
    }
    let roots: Vec<usize> = (0..n).filter(|&i| classes.root[i] == i).collect();
    let (mut class_column, mut unknowns) = (vec![NONE; n], Vec::new());
    for &root in &roots {
        if pin[root].is_none() && read[root] { class_column[root] = unknowns.len(); unknowns.push(system.unknowns[root]); }
    }
    let kept: Vec<usize> = (0..equations.len()).filter(|&i| role[i] == Role::Kept).collect();

    // The whole group's ordering, which its diagnosis uses; one too large to order is solved whole.
    let ordering = minimum_degree(n, &rows.iter().map(|row| &row.columns[..row.len]).collect::<Vec<_>>(), limits.fill, limits.work)?;
    let mut work = ordering.work;

    // The nearest start that meets the eliminated rows: a pinned class where it is pinned, a free
    // class at the mean of its members less their offsets.
    let start: Vec<f64> = system.unknowns.iter().map(|&p| values[p]).collect();
    let restore = |values: &mut [f64]| { for (&p, &value) in system.unknowns.iter().zip(&start) { values[p] = value; } };
    for &root in &roots {
        let base = pin[root].unwrap_or_else(|| classes.members(root).map(|m| start[m] - classes.offset[m]).sum::<f64>() / classes.size[root] as f64);
        for m in classes.members(root) { values[system.unknowns[m]] = if m == root { base } else { base + classes.offset[m] }; }
    }
    let constant: Vec<usize> = (0..equations.len()).filter(|&i| role[i] == Role::Constant).map(|i| system.equations[i]).collect();
    if !constant.is_empty() {
        let check = System { problem, column, equations: constant, unknowns: Vec::new(), map: None };
        if !check.rows(values, None).iter().all(accepted) { restore(values); return None; }
    }

    let mut followers = Vec::new();
    let mut scale = vec![0.0; unknowns.len()];
    for &root in &roots {
        let c = class_column[root];
        if c == NONE { continue; }
        scale[c] = 1.0 / (classes.size[root] as f64).sqrt();
        for m in classes.members(root) {
            scratch[system.unknowns[m]] = c;
            if m != root { followers.push((system.unknowns[m], c, classes.offset[m])); }
        }
    }
    let map = ColumnMap { scale, followers };
    let solved = {
        let reduced = System { problem, column: &*scratch, equations: kept.iter().map(|&i| system.equations[i]).collect(), unknowns, map: Some(&map) };
        solve_group_within(&reduced, values, Limits { work: limits.work.saturating_sub(work), ..limits }, MAX_ITERATIONS)
    };
    for &p in &system.unknowns { scratch[p] = NONE; }
    work = work.saturating_add(solved.work);
    if solved.status != Status::Converged || solved.position.is_none() || work > limits.work { restore(values); return None; }

    let ended = system.rows(values, None);
    if !assess(&ended).accepted { restore(values); return None; }
    let budget = limits.work.saturating_sub(work);
    match diagnose_group(system, values, &ordering.position, TAU, budget, limits.fill) {
        (Some((rank, witnesses, true)), spent) if spent <= budget => Some(Eliminated {
            group: GroupOutcome { status: Status::Converged, iterations: solved.iterations, residual: worst(&ended), position: Some(ordering.position), work, drag: None },
            diagnosis: (rank, witnesses, true), spent }),
        _ => { restore(values); None }
    }
}
