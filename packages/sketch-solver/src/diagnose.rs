//! Rank and dependency diagnosis of one group's Jacobian, the information sketch feedback needs:
//! degrees of freedom and which constraints are redundant or conflicting.
//!
//! Rows go into an undamped sparse factor in their given order, so an equation is dependent when
//! it lies within `TAU` of the span of the earlier independent ones, which leaves the factor as it
//! was. Each dependent row gets a witness: the earlier rows whose combination reproduces it.
//! Constraints are tagged groups of rows. Each witness has one equation set aside: as PlaneGCS
//! prefers on ties, one of a constraint with fewer equations, then of the later constraint, then
//! the earlier equation; one equation can cover several witnesses. PlaneGCS first prefers the
//! equation in most witnesses, but its witnesses come from a pivoted factor, while these are over
//! the earliest rows, which would then always be blamed. A witness agrees when the same
//! combination of residuals is within the rows' tolerances. Equations set aside whose
//! witnesses all agree are redundant, and every constraint of a witness without a redundant
//! equation conflicts. The combination of residuals is first-order constant in the unknowns, so the
//! test holds at any point near a solution, including the nearest one of a conflicting sketch.
//!
//! The nearest point of a conflicting sketch often collapses geometry, as a triangle too long
//! for its sides flattens onto a line. Gauss-Newton converges onto such a point only linearly and
//! stops about `sqrt(epsilon)` short of it relatively, where rank at `TAU` is unclear. A group
//! that did not converge is then diagnosed again with rows within `STALLED` dependent; the
//! sketch is rejected either way, but this blame is a suspicion: a row near a conflict without
//! being in it can be blamed too, and a satisfiable sketch stuck at a stationary point is blamed
//! as conflicting. Where relations are the same function of the same values, as repeated
//! dimensions are, held at values that cannot agree, the group is blamed for those instead, before
//! any rank is read: they depend on each other at every point, so they conflict wherever it
//! stopped, even where a stall that ran off cannot be diagnosed at all. Angles, whose residuals
//! wrap, are left out.
//!
//! Near a singular configuration, as a point a little off where its circle touches its line, rank
//! at `TAU` is unclear for a solved sketch too. A row whose insertion or witness cannot be decided
//! is left out, which leaves the factor as it was, so later rows are decided as before; the
//! diagnosis is then not `certain`, and neither is one whose independent rows are not shown to
//! have a smallest singular value of at least `CERTAIN`. Its witnesses are dependencies found, but more may exist, so freedom is
//! unknown. A row that exactly copies a row left out earlier, or its negation, depends on that row
//! alone, so a repeated relation is still labelled beside an undecided one.
//!
//! Where rank is certain at `TAU`, each column's definition can be asked for (see `define`).
//! Determined means the certified projection of the column's unit vector onto the directions the
//! independent rows leave free is at most `TAU`, the dependence distance. Free means a direction
//! certified to move every row by at most `TAU` per unit is certified to move the column by more
//! than `CERTAIN`. The factor only proposes either. Each is certified against the rows given in
//! compensated arithmetic, with a bound on that arithmetic's own rounding. Between `TAU` and
//! `CERTAIN`, and once the probes' own allowance runs out, the column is not analysed.

use crate::sparse::SparseRow;

/// Distance from the span of earlier rows, for rows of unit norm, below which a row is dependent.
pub const TAU: f64 = 1e-10;
/// Smallest singular value the independent rows must be shown to reach for rank to be certain.
const CERTAIN: f64 = 1e3 * TAU;
/// Dependence distance for a group that stalled short of the nearest point of a conflict: about
/// seven times the largest distance seen there, so that independent pairs held near-singular
/// beside a conflict still pass the unchanged `CERTAIN` gate.
pub const STALLED: f64 = 1e-6;

/// Label bits of an equation: its constraint is redundant through it, or conflicts.
pub const REDUNDANT: u8 = 1;
pub const CONFLICTING: u8 = 2;

/// Definition codes of a parameter: not analysed, free to move, or determined (see `define`).
pub const NOT_ANALYSED: u8 = 0;
pub const FREE: u8 = 1;
pub const DETERMINED: u8 = 2;
/// Most counted entries the definition probes of one solve may take. They take them apart from the
/// work of the solve and its diagnosis, so asking for definition changes neither.
pub const DEFINITION_WORK: usize = 20_000_000;

/// One row of the group's Jacobian at the diagnosed values.
pub struct Row {
    /// Entries by column position, sorted; the row's norm need not be one.
    pub entries: SparseRow,
    pub residual: f64,
    /// Largest residual the solver accepts for this row, in the same units.
    pub tolerance: f64,
}

pub struct Diagnosis {
    pub rank: usize,
    pub witnesses: Vec<Witness>,
    /// Every row was decided and the independent rows' smallest singular value was shown to reach
    /// `CERTAIN`. Otherwise rank is unclear: the witnesses found are dependencies within
    /// `distance`, but more may exist, so freedom is unknown.
    pub certain: bool,
    /// Each column position's definition code, when it was asked for and rank is certain at `TAU`.
    pub definition: Option<Vec<u8>>,
}

/// A dependent row with the earlier rows that reproduce it.
pub struct Witness {
    /// Row indices in increasing order, the dependent row last.
    pub rows: Vec<usize>,
    /// The same combination of residuals is within the rows' tolerances.
    pub agrees: bool,
}

/// The diagnosis of `rows` over `n` columns, with a row dependent within `distance` (`TAU` or
/// `STALLED`) of the span of earlier ones, and the work spent; `None` when a row is not finite or
/// the work would pass `budget` entries. A row whose dependence cannot be decided, or whose witness
/// fit would hold more than `fill`, is left out and leaves the diagnosis uncertain: the factor is
/// then as it was, so the rows after it are decided as before.
pub fn diagnose(n: usize, rows: &[Row], distance: f64, budget: usize, fill: usize) -> (Option<Diagnosis>, usize) {
    diagnose_defining(n, rows, distance, budget, fill, None)
}

/// `diagnose`, with each column's definition when `allowance` is given, `distance` is `TAU` and
/// rank is certain. The probes take their work from `allowance` alone, so the diagnosis and the
/// work it reports are the same as without them.
pub fn diagnose_defining(n: usize, rows: &[Row], distance: f64, budget: usize, fill: usize, allowance: Option<&mut usize>) -> (Option<Diagnosis>, usize) {
    let mut work = Work { done: 0, budget, fill, out: false };
    let found = diagnose_within(n, rows, distance, &mut work, allowance);
    (found, work.spent())
}

fn diagnose_within(n: usize, rows: &[Row], distance: f64, work: &mut Work, allowance: Option<&mut usize>) -> Option<Diagnosis> {
    let mut r: Vec<SparseRow> = vec![Vec::new(); n];
    let mut rank = 0;
    // Each dependent row with the earlier rows of its witness.
    let mut witnesses: Vec<(usize, Vec<(usize, f64)>)> = Vec::new();
    let norms: Vec<f64> = rows.iter().map(|row| row.entries.iter().map(|e| e.1 * e.1).sum::<f64>().sqrt()).collect();
    let (mut independent, mut certain) = (Vec::new(), true);
    // Rows left out, each with its unit row, and the entries matching them may still read.
    let (mut left_out, mut reads): (Vec<(usize, SparseRow)>, usize) = (Vec::new(), rows.iter().map(|row| row.entries.len() + 1).sum());
    // How far the rows `r` factors may differ from the independent rows, by the leads they dropped.
    let mut truncated = 0.0;
    for (index, row) in rows.iter().enumerate() {
        if !row.residual.is_finite() || !norms[index].is_finite() { return None; }
        if norms[index] == 0.0 { witnesses.push((index, Vec::new())); continue; }
        let unit = unit(row, norms[index]);
        let decided = match insert(&mut r, unit.clone(), distance, work) {
            Some(Insertion::Independent(dropped)) => { rank += 1; independent.push(index); truncated += dropped.sqrt(); true }
            Some(Insertion::Dependent) => witness(&r, &unit, rows, &norms, &independent, distance, work)
                .map(|support| witnesses.push((index, support))).is_some(),
            None => false,
        };
        if !decided {
            if work.run_out() { return None; }
            certain = false;
            // An exact copy of a row left out earlier, or its negation, depends on that row alone.
            match copied(&left_out, &unit, &mut reads) {
                Some((earlier, sign)) => witnesses.push((index, vec![(earlier, sign)])),
                None => left_out.push((index, unit)),
            }
        }
    }
    if rank > 0 && !clear_of_dependence(&r, work)? { certain = false; }
    let definition = allowance.filter(|_| certain && distance == TAU).map(|allowance| define(&mut r, rows, &norms, &independent, truncated, allowance));
    // A unit row's residual, or the residual itself for a row without unknowns.
    let scaled = |i: usize, value: f64| if norms[i] > 0.0 { value / norms[i] } else { value };
    let witnesses = witnesses.into_iter().map(|(j, support)| {
        let combined = support.iter().map(|&(i, c)| c * scaled(i, rows[i].residual)).sum::<f64>() - scaled(j, rows[j].residual);
        let bound = support.iter().map(|&(i, c)| c.abs() * scaled(i, rows[i].tolerance)).sum::<f64>() + scaled(j, rows[j].tolerance);
        Witness { rows: support.iter().map(|s| s.0).chain([j]).collect(), agrees: combined.abs() <= bound }
    }).collect();
    Some(Diagnosis { rank, witnesses, certain, definition })
}

/// Each column's definition by the rows given, whose rows `independent` are independent with rank
/// certain at `TAU`. `r` factors those as unit rows, less the leads their insertions dropped, and
/// `truncated` is the sum of each insertion's dropped length. The free space is the set of
/// directions the independent rows leave still. Leaving out the dependent rows can only enlarge
/// it, so what holds over it holds over every row.
///
/// - `DETERMINED`: the free space is certified to move the column by at most `TAU` per unit. `span`
///   finds a combination of the rows that misses the column's unit vector by at most that, and the
///   unit vector's projection onto the free space is no longer than that miss. `TAU` is the
///   dependence distance, so a column is determined just when fixing it would add only a dependent
///   equation.
/// - `FREE`: a direction is certified to move every row by at most `TAU` per unit, and the column
///   by more than `CERTAIN` per unit plus the most the nearest exact free direction can differ by
///   (see `Direction::frees`).
/// - `NOT_ANALYSED`: everything else, including columns moved by more than `TAU` but not shown to
///   move by more than `CERTAIN`, and the columns left once the probes would take more than
///   `allowance`, which they take from.
///
/// `probe` only proposes a code through `r`. Rounding there can move what it measures by about
/// `epsilon` over the smallest pivot, more than `TAU`, so only a certificate decides.
///
/// With no direction left free, every column is determined. That rests on rank's certainty: the
/// independent unit rows' smallest singular value is shown through `r` to reach `CERTAIN`, so it is
/// at least `CERTAIN` less `truncated`, which is more than half of `CERTAIN` when `truncated` is
/// below that. The factor's own rounding moves it by about `epsilon` times the rows' norm, as it
/// does for rank. Where `truncated` is not below half of `CERTAIN`, no column is shown free and a
/// full-rank group is not analysed. `r` is left as it was.
fn define(r: &mut [SparseRow], rows: &[Row], norms: &[f64], independent: &[usize], truncated: f64, allowance: &mut usize) -> Vec<u8> {
    let n = r.len();
    let mut work = Work { done: 0, budget: *allowance, fill: usize::MAX, out: false };
    // A bound from below on the independent unit rows' smallest singular value.
    let floor = (truncated < CERTAIN / 2.0).then_some(CERTAIN - truncated);
    let mut codes = vec![NOT_ANALYSED; n];
    if independent.len() == n {
        if floor.is_some() { codes.fill(DETERMINED); }
    } else if let Some(mut group) = Group::new(r, rows, norms, independent, &mut work) {
        let mut freedom: Vec<Option<Direction>> = (0..n).map(|_| None).collect();
        for j in 0..n {
            if let Some(code) = probe(r, &mut group, j, floor, &mut freedom, &mut work) { codes[j] = code; }
            if work.run_out() { break; }
        }
    }
    *allowance = allowance.saturating_sub(work.done);
    codes
}

/// Most corrections `Group::span` makes to its coefficients.
const CORRECTIONS: usize = 8;

/// Proposes a code for column `j` by rotating its unit row into `r` as `insert` does, leaving `r`
/// as it was. A rotation leaves its cosine times what it would leave with the row subtracted
/// outright, so each lead is measured against the product of the cosines so far.
///
/// - If every lead that reaches an empty pivot is within `TAU`, so measured, and their root sum of
///   squares is too, the column looks determined. It is `DETERMINED` if `Group::span` certifies
///   it.
/// - A lead above `TAU` that reaches an empty pivot `k` shows the free direction of `k` moving the
///   column. The column is `FREE` if that direction is certified to free it. Otherwise the lead is
///   dropped and the probe goes on to the next empty pivot, whose direction is zero at `k`; the
///   column can then no longer look determined.
///
/// `None` when nothing is certified, and when the work runs out.
fn probe(r: &mut [SparseRow], group: &mut Group, j: usize, floor: Option<f64>, freedom: &mut [Option<Direction>], work: &mut Work) -> Option<u8> {
    let (mut v, mut shrink, mut dropped, mut undecided): (SparseRow, f64, f64, bool) = (vec![(j, 1.0)], 1.0, 0.0, false);
    loop {
        // `None` when the work ran out; then the empty pivot reached, or `None` when nothing is
        // left. Only the pivots before it are rotated, so the rows past it are as they were when
        // the probe goes on.
        let mut undo = Vec::new();
        let reached = loop {
            let Some(&(k, lead)) = v.first() else { break Some(None) };
            if r[k].is_empty() {
                if lead.abs() > TAU { break Some(Some(k)); }
                dropped += (lead / shrink).powi(2);
                v.remove(0);
                continue;
            }
            let Some((kept, rest)) = rotate(&r[k], &v, work) else { break None };
            shrink *= (r[k][0].1 / kept[0].1).abs();
            undo.push((k, std::mem::replace(&mut r[k], kept)));
            v = rest;
        };
        for (k, row) in undo.into_iter().rev() { r[k] = row; }
        let Some(k) = reached? else {
            if undecided || dropped.sqrt() > TAU { return None; }
            return (group.span(r, j, work)? <= TAU).then_some(DETERMINED);
        };
        if freedom[k].is_none() { freedom[k] = Some(group.direction(r, k, work)?); }
        if freedom[k].as_ref().is_some_and(|direction| direction.frees(j, floor)) { return Some(FREE); }
        undecided = true;
        v.remove(0);
    }
}

/// The free direction of a column `k` without a pivot in the factor, with bounds on its length and
/// on how far it moves the rows given. It is one at `k`, zero at the other columns without pivots,
/// and at each pivot what keeps that pivot's row still.
struct Direction {
    /// By increasing column.
    entries: SparseRow,
    /// Bounds from below and above on the length of `entries`.
    shortest: f64,
    longest: f64,
    /// A bound from above on the length of what it moves the nonzero unit rows given.
    moved: f64,
}

impl Direction {
    /// Whether the direction frees column `j`. It must move every row by at most `TAU` per unit of
    /// its length, within the rank tolerance. It must also move the column by more than `CERTAIN`
    /// per unit plus `moved` over `floor`, a bound from below on the independent unit rows'
    /// smallest singular value. The exact free direction nearest it, its part those rows leave
    /// still, differs from it by at most `moved` over `floor`, so that direction also moves the
    /// column by more than `CERTAIN` per unit. Never with no `floor`.
    fn frees(&self, j: usize, floor: Option<f64>) -> bool {
        let (Some(floor), Ok(at)) = (floor, self.entries.binary_search_by_key(&j, |e| e.0)) else { return false };
        // Each operation here rounds by at most half an epsilon.
        self.moved <= TAU * self.shortest
            && self.entries[at].1.abs() > (CERTAIN * self.longest + self.moved / floor) * (1.0 + 4.0 * f64::EPSILON)
    }
}

/// The rows given, by column, as the certificates read them. Its scratch space over columns and
/// rows is zero and clear between uses.
struct Group<'a> {
    rows: &'a [Row],
    norms: &'a [f64],
    /// The nonzero rows holding each column, in increasing order.
    holding: Vec<Vec<usize>>,
    independent: Vec<bool>,
    /// The rows of the factor holding each column past their lead.
    columns: Vec<Vec<usize>>,
    /// The most terms a compensated sum over one column takes: one for the unit vector and two for
    /// each row.
    terms: usize,
    high: Vec<f64>,
    low: Vec<f64>,
    size: Vec<f64>,
    queued: Vec<bool>,
    marked: Vec<bool>,
}

impl<'a> Group<'a> {
    /// `None` when the work runs out.
    fn new(r: &[SparseRow], rows: &'a [Row], norms: &'a [f64], independent: &[usize], work: &mut Work) -> Option<Group<'a>> {
        let n = r.len();
        work.take(2 * n + rows.len() + rows.iter().map(|row| row.entries.len()).sum::<usize>() + r.iter().map(|row| row.len()).sum::<usize>())?;
        let (mut holding, mut columns, mut flags) = (vec![Vec::new(); n], vec![Vec::new(); n], vec![false; rows.len()]);
        for (i, row) in rows.iter().enumerate().filter(|&(i, _)| norms[i] > 0.0) {
            for &(c, _) in &row.entries { holding[c].push(i); }
        }
        for (p, row) in r.iter().enumerate() {
            for &(c, _) in row.iter().skip(1) { columns[c].push(p); }
        }
        for &i in independent { flags[i] = true; }
        let terms = 1 + 2 * holding.iter().map(Vec::len).max().unwrap_or(0);
        Some(Group { rows, norms, holding, independent: flags, columns, terms, high: vec![0.0; n], low: vec![0.0; n], size: vec![0.0; n],
            queued: vec![false; n], marked: vec![false; rows.len()] })
    }

    /// A bound from above on the distance of `e_j` from the span of the independent rows, which
    /// bounds how far any unit free direction moves column `j`. Coefficients of the rows given come
    /// from the seminormal equations through `r`. They are corrected while what they miss of `e_j`
    /// shrinks, until the bound is within `TAU`, and kept in twice the working precision. `miss`
    /// gives the bound. `None` when the work runs out.
    fn span(&mut self, r: &[SparseRow], j: usize, work: &mut Work) -> Option<f64> {
        let (mut coefficients, mut missing, mut norm, mut bound): (Vec<Coefficient>, SparseRow, f64, f64) = (Vec::new(), vec![(j, 1.0)], 1.0, 1.0);
        for _ in 0..CORRECTIONS {
            if bound <= TAU { break; }
            let change = self.correction(r, &missing, work)?;
            if change.is_empty() { break; }
            work.take(coefficients.len() + change.len())?;
            let trial = corrected(&coefficients, &change);
            let (miss, size, within) = self.miss(j, &trial, work)?;
            if size >= norm { break; }
            (coefficients, missing, norm, bound) = (trial, miss, size, within);
        }
        Some(bound)
    }

    /// The change of coefficients of the independent rows given that the seminormal equations
    /// through `r` take for `missing` over the pivot columns: `R^T R z = missing`, then each row's
    /// entries times `z` over its squared norm. By increasing row; `None` when the work runs out.
    fn correction(&mut self, r: &[SparseRow], missing: &SparseRow, work: &mut Work) -> Option<Vec<(usize, f64)>> {
        use std::{cmp::Reverse, collections::BinaryHeap};
        let Group { rows, norms, holding, independent, columns, high: w, low: z, queued, marked, .. } = self;
        // `R^T w = missing` from the first pivot it reaches, then `R z = w` from the last, through
        // the rows reaching those, each pivot once every one it reads is known.
        let (mut ahead, mut taken, mut out) = (BinaryHeap::new(), Vec::new(), false);
        for &(c, x) in missing.iter().filter(|e| !r[e.0].is_empty()) {
            (w[c], queued[c]) = (x, true);
            ahead.push(Reverse(c));
        }
        while let Some(Reverse(k)) = ahead.pop() {
            taken.push(k);
            if work.take(r[k].len()).is_none() { out = true; break; }
            w[k] /= r[k][0].1;
            for &(c, x) in r[k][1..].iter().filter(|e| !r[e.0].is_empty()) {
                w[c] -= x * w[k];
                if !queued[c] { queued[c] = true; ahead.push(Reverse(c)); }
            }
        }
        let started: Vec<usize> = taken.iter().copied().chain(ahead.into_iter().map(|Reverse(k)| k)).collect();
        for &k in &started { queued[k] = false; }
        let (mut behind, mut solved) = (BinaryHeap::new(), Vec::new());
        if !out {
            for &k in &taken { queued[k] = true; behind.push(k); }
            while let Some(k) = behind.pop() {
                solved.push(k);
                if work.take(r[k].len() + columns[k].len()).is_none() { out = true; break; }
                z[k] = (w[k] - r[k][1..].iter().map(|&(c, x)| x * z[c]).sum::<f64>()) / r[k][0].1;
                for &p in &columns[k] {
                    if !queued[p] { queued[p] = true; behind.push(p); }
                }
            }
        }
        let mut change = Vec::new();
        if !out {
            out = work.take(solved.iter().map(|&k| holding[k].len()).sum()).is_none();
            let mut held = Vec::new();
            for &k in solved.iter().filter(|_| !out) {
                for &i in holding[k].iter().filter(|&&i| independent[i]) {
                    if !marked[i] { marked[i] = true; held.push(i); }
                }
            }
            out = out || work.take(held.iter().map(|&i| rows[i].entries.len()).sum()).is_none();
            held.sort_unstable();
            for &i in &held {
                marked[i] = false;
                if !out { change.push((i, rows[i].entries.iter().map(|&(c, x)| x * z[c]).sum::<f64>() / (norms[i] * norms[i]))); }
            }
        }
        for &k in &started { w[k] = 0.0; }
        for k in solved.into_iter().chain(behind) { (z[k], queued[k]) = (0.0, false); }
        (!out).then_some(change)
    }

    /// What `coefficients` of the rows given miss of `e_j` per column, with its computed norm and a
    /// bound from above on the exact miss's norm; `None` when the work runs out. Each column's miss
    /// is a Dot2 sum (Ogita, Rump and Oishi, 2005): two exact products per row, one for each part
    /// of its coefficient, summed exactly with the errors carried. Barring underflow, a sum of at
    /// most `terms` terms whose magnitudes add up to `S` is within `u |exact| + gamma(terms)^2 S` of
    /// the exact sum, `u` being the unit roundoff. The bound also allows for rounding in the norm
    /// and in the magnitudes.
    fn miss(&mut self, j: usize, coefficients: &[Coefficient], work: &mut Work) -> Option<(SparseRow, f64, f64)> {
        work.take(2 * (1 + coefficients.iter().map(|&(i, ..)| self.rows[i].entries.len()).sum::<usize>()))?;
        let Group { rows, high, low, size, queued, terms, .. } = self;
        let mut touched = vec![j];
        (high[j], size[j], queued[j]) = (1.0, 1.0, true);
        for &(i, upper, lower) in coefficients {
            for &(c, x) in &rows[i].entries {
                if !queued[c] { queued[c] = true; touched.push(c); }
                for part in [upper, lower] {
                    let (term, error) = two_product(-part, x);
                    let (sum, carried) = two_sum(high[c], term);
                    (high[c], low[c], size[c]) = (sum, low[c] + (carried + error), size[c] + term.abs());
                }
            }
        }
        touched.sort_unstable();
        let (mut missing, mut squares, mut sizes) = (Vec::with_capacity(touched.len()), 0.0, 0.0);
        for &c in &touched {
            let value = high[c] + low[c];
            if value != 0.0 { missing.push((c, value)); }
            (squares, sizes) = (squares + value * value, sizes + size[c]);
            (high[c], low[c], size[c], queued[c]) = (0.0, 0.0, 0.0, false);
        }
        let norm = squares.sqrt();
        let bound = (norm * (1.0 + gamma(touched.len() + 4)) + 4.0 * gamma(*terms).powi(2) * sizes) * (1.0 + gamma(4));
        Some((missing, norm, bound))
    }

    /// The free direction of column `k`, which has no pivot in `r`, by back substitution from `k`
    /// through the rows that reach it. Its length is bounded from both sides: a sum of squares of
    /// `len` terms and its root round by at most `gamma(len + 2)` relatively. What it moves each
    /// nonzero unit row given is bounded from above by a Dot2 sum as in `miss`, over the row's
    /// norm, which rounds in the same way. `None` when the work runs out.
    fn direction(&mut self, r: &[SparseRow], k: usize, work: &mut Work) -> Option<Direction> {
        let Group { rows, norms, holding, columns, low: x, queued, marked, .. } = self;
        // Pivots from the last, each once every later one it reads has moved.
        let (mut reached, mut taken, mut squares, mut out) = (std::collections::BinaryHeap::new(), vec![k], 1.0, false);
        x[k] = 1.0;
        for &p in &columns[k] { queued[p] = true; reached.push(p); }
        while let Some(p) = reached.pop() {
            taken.push(p);
            if work.take(r[p].len() + columns[p].len()).is_none() { out = true; break; }
            x[p] = -r[p][1..].iter().map(|&(c, e)| e * x[c]).sum::<f64>() / r[p][0].1;
            squares += x[p] * x[p];
            for &q in &columns[p] {
                if !queued[q] { queued[q] = true; reached.push(q); }
            }
        }
        let (mut moved, mut held) = (0.0, Vec::new());
        out = out || work.take(taken.iter().map(|&c| holding[c].len()).sum()).is_none();
        for &c in taken.iter().filter(|_| !out) {
            for &i in &holding[c] {
                if !marked[i] { marked[i] = true; held.push(i); }
            }
        }
        out = out || work.take(held.iter().map(|&i| rows[i].entries.len()).sum()).is_none();
        for &i in &held {
            marked[i] = false;
            if out { continue; }
            let (mut high, mut low, mut size) = (0.0, 0.0, 0.0);
            for &(c, e) in &rows[i].entries {
                let (term, error) = two_product(e, x[c]);
                let (sum, carried) = two_sum(high, term);
                (high, low, size) = (sum, low + (carried + error), size + term.abs());
            }
            let len = rows[i].entries.len();
            let bound = ((high + low).abs() + 2.0 * gamma(len + 1).powi(2) * size) * (1.0 + gamma(4)) / (norms[i] * (1.0 - gamma(len + 2)));
            moved += bound * bound;
        }
        let mut entries: SparseRow = taken.iter().map(|&p| (p, x[p])).filter(|e| e.1 != 0.0).collect();
        let len = taken.len();
        for p in taken.into_iter().chain(reached) { (x[p], queued[p]) = (0.0, false); }
        if out { return None; }
        entries.sort_unstable_by_key(|e| e.0);
        let length = squares.sqrt();
        Some(Direction { entries, shortest: length * (1.0 - gamma(len + 2)), longest: length * (1.0 + gamma(len + 2)),
            moved: moved.sqrt() * (1.0 + gamma(held.len() + 2)) })
    }
}

/// `coefficients` with `change` added, both by increasing row, in twice the working precision.
fn corrected(coefficients: &[Coefficient], change: &[(usize, f64)]) -> Vec<Coefficient> {
    let (mut sum, mut i, mut d) = (Vec::with_capacity(coefficients.len() + change.len()), 0, 0);
    while i < coefficients.len() || d < change.len() {
        let row = coefficients.get(i).map_or(usize::MAX, |c| c.0).min(change.get(d).map_or(usize::MAX, |e| e.0));
        let (high, low) = if coefficients.get(i).is_some_and(|c| c.0 == row) { i += 1; (coefficients[i - 1].1, coefficients[i - 1].2) } else { (0.0, 0.0) };
        let step = if change.get(d).is_some_and(|e| e.0 == row) { d += 1; change[d - 1].1 } else { 0.0 };
        let (total, error) = two_sum(high, step);
        let (high, low) = two_sum(total, error + low);
        sum.push((row, high, low));
    }
    sum
}

/// `k u / (1 - k u)` for the unit roundoff `u`, a bound on the relative rounding of `k` operations
/// in sequence.
fn gamma(k: usize) -> f64 {
    let ku = k as f64 * (f64::EPSILON / 2.0);
    ku / (1.0 - ku)
}

/// How many of `rows`, zero rows included, lie within `distance` of the span of earlier ones once
/// normalized, and the work spent; no singular value gate applies. `None` when a row's dependence
/// cannot be decided or the work would pass `budget`.
pub fn dependent_count(n: usize, rows: &[SparseRow], distance: f64, budget: usize) -> (Option<usize>, usize) {
    let mut work = Work { done: 0, budget, fill: usize::MAX, out: false };
    let found = (|| {
        let (mut r, mut count) = (vec![Vec::new(); n], 0);
        for row in rows {
            let norm = row.iter().map(|e| e.1 * e.1).sum::<f64>().sqrt();
            if !norm.is_finite() { return None; }
            if norm == 0.0 { count += 1; continue; }
            if let Insertion::Dependent = insert(&mut r, row.iter().map(|&(k, x)| (k, x / norm)).collect(), distance, &mut work)? { count += 1; }
        }
        Some(count)
    })();
    (found, work.spent())
}

/// Indices of the nonzero `rows` within `TAU` of the span of earlier ones once normalized, and
/// the work spent; `None` when some are and rank cannot be decided reliably, or the work would
/// pass `budget`. A factor that rank is checked through holds at most `fill` entries.
pub fn dependent(n: usize, rows: &[SparseRow], budget: usize, fill: usize) -> (Option<Vec<usize>>, usize) {
    let mut work = Work { done: 0, budget, fill, out: false };
    let found = (|| {
        let (mut r, mut dependent) = (vec![Vec::new(); n], Vec::new());
        for (index, row) in rows.iter().enumerate() {
            let norm = row.iter().map(|e| e.1 * e.1).sum::<f64>().sqrt();
            if !norm.is_finite() { return None; }
            if norm == 0.0 { continue; }
            match insert(&mut r, row.iter().map(|&(k, x)| (k, x / norm)).collect(), TAU, &mut work)? {
                Insertion::Independent(_) => {}
                Insertion::Dependent => dependent.push(index),
            }
        }
        // Rank matters only for rows set aside; none leaves nothing to check.
        if !dependent.is_empty() && !clear_of_dependence(&r, &mut work)? { return None; }
        Some(dependent)
    })();
    (found, work.spent())
}

/// The earlier left-out row `unit` copies exactly, and `1` or `-1` as it is that row or its
/// negation; `None` when none is, or once matching would read more than `reads` entries. The
/// allowance is the rows' own size, so matching stays linear and the work limit is left to the
/// factor: it never changes what is decided.
fn copied(left_out: &[(usize, SparseRow)], unit: &SparseRow, reads: &mut usize) -> Option<(usize, f64)> {
    for (index, earlier) in left_out {
        let cost = earlier.len().min(unit.len()) + 1;
        if *reads < cost { *reads = 0; return None; }
        *reads -= cost;
        if earlier.len() != unit.len() { continue; }
        for sign in [1.0, -1.0] {
            if earlier.iter().zip(unit).all(|(a, b)| a.0 == b.0 && a.1 * sign == b.1) { return Some((*index, sign)); }
        }
    }
    None
}

fn unit(row: &Row, norm: f64) -> SparseRow { row.entries.iter().map(|&(k, x)| (k, x / norm)).collect() }

/// Entries written so far against `budget`, and the entries a witness fit's factor may hold;
/// `out` once a step was refused because it could pass `budget`.
struct Work { done: usize, budget: usize, fill: usize, out: bool }

impl Work {
    fn spend(&mut self, entries: usize) -> Option<()> {
        self.done = self.done.saturating_add(entries);
        (self.done <= self.budget).then_some(())
    }
    /// Whether `entries` more fit before they are spent; when they do not, the work has run out
    /// without them.
    fn afford(&mut self, entries: usize) -> Option<()> {
        self.out |= self.done.saturating_add(entries) > self.budget;
        (!self.out).then_some(())
    }
    /// `afford` then `spend`.
    fn take(&mut self, entries: usize) -> Option<()> {
        self.afford(entries)?;
        self.spend(entries)
    }
    fn run_out(&self) -> bool { self.out || self.done > self.budget }
    /// The work spent, past `budget` when it ran out, which callers read as running out.
    fn spent(&self) -> usize { if self.out { self.done.max(self.budget.saturating_add(1)) } else { self.done } }
}

/// An independent row carries the sum of squares of the leads it dropped before claiming a pivot.
enum Insertion { Independent(f64), Dependent }

/// Rotates `v` into `r`. A remainder reaching an empty pivot claims it when its lead exceeds
/// `distance`, and otherwise drops that lead and goes on. A row whose dropped leads stay within
/// `distance` is dependent and leaves `r` as it was; `None` when they do not, since rank is then
/// unclear. The leads an independent row drops stay out of `r`, which then factors rows that each
/// differ from the row given by them.
fn insert(r: &mut [SparseRow], mut v: SparseRow, distance: f64, work: &mut Work) -> Option<Insertion> {
    let (mut undo, mut dropped) = (Vec::new(), 0.0);
    while let Some(&(k, lead)) = v.first() {
        if r[k].is_empty() {
            if lead.abs() > distance {
                r[k] = v;
                return Some(Insertion::Independent(dropped));
            }
            dropped += lead * lead;
            v.remove(0);
            continue;
        }
        let (kept, rest) = rotate(&r[k], &v, work)?;
        undo.push((k, std::mem::replace(&mut r[k], kept)));
        v = rest;
    }
    for (k, row) in undo.into_iter().rev() { r[k] = row; }
    (dropped.sqrt() <= distance).then_some(Insertion::Dependent)
}

/// The Givens rotation of `v` against `row`, whose lead is in the column of the lead of `v`:
/// the rotated row and what is left of `v`; `None` when the work could run out, which is checked
/// before rotating.
fn rotate(row: &SparseRow, v: &SparseRow, work: &mut Work) -> Option<(SparseRow, SparseRow)> {
    // Each holds at most the lead and every column of either.
    work.afford(2 * (row.len() + v.len()))?;
    let (k, pivot, lead) = (row[0].0, row[0].1, v[0].1);
    let big = pivot.abs().max(lead.abs());
    let radius = big * ((pivot / big).powi(2) + (lead / big).powi(2)).sqrt();
    let (cos, sin) = (pivot / radius, lead / radius);
    let (mut kept, mut rest) = (vec![(k, radius)], Vec::new());
    let (mut i, mut j) = (1, 1);
    while i < row.len() || j < v.len() {
        let column = row.get(i).map_or(usize::MAX, |e| e.0).min(v.get(j).map_or(usize::MAX, |e| e.0));
        let x = if row.get(i).is_some_and(|e| e.0 == column) { i += 1; row[i - 1].1 } else { 0.0 };
        let y = if v.get(j).is_some_and(|e| e.0 == column) { j += 1; v[j - 1].1 } else { 0.0 };
        let (a, b) = (cos * x + sin * y, cos * y - sin * x);
        if a != 0.0 { kept.push((column, a)); }
        if b != 0.0 { rest.push((column, b)); }
    }
    work.spend(kept.len() + rest.len())?;
    Some((kept, rest))
}

/// `R^T y = a`, then `R z = y`, over the columns with pivots; the others take zero.
fn seminormal(r: &[SparseRow], mut a: Vec<f64>, work: &mut Work) -> Option<Vec<f64>> {
    let n = r.len();
    let mut y = vec![0.0; n];
    for k in 0..n {
        let Some(&(_, pivot)) = r[k].first() else { continue };
        y[k] = a[k] / pivot;
        for &(j, x) in &r[k][1..] { a[j] -= x * y[k]; }
    }
    let mut z = vec![0.0; n];
    for k in (0..n).rev() {
        let Some(&(_, pivot)) = r[k].first() else { continue };
        z[k] = (y[k] - r[k][1..].iter().map(|&(j, x)| x * z[j]).sum::<f64>()) / pivot;
    }
    work.spend(2 * r.iter().map(|row| row.len()).sum::<usize>())?;
    Some(z)
}

/// The earlier independent unit rows that reproduce `v`, which lies within `distance` of their
/// span, with their coefficients; coefficients too small to move the combination by `distance`
/// together are left out. A row within `distance` of the span can lean on a nearly parallel one
/// by up to about `epsilon / CERTAIN^2` relatively; a row whose coefficient is that small stays
/// only when the others do not reproduce `v` without it. `None` when the rows left do not
/// reproduce it within twice `distance`, its own and what was left out (an insertion's remainder
/// shrinks with the earlier pivots, so a row far from the span of rows with small pivots can
/// look dependent, and rank is then unclear), or when a removal cannot be decided.
fn witness(r: &[SparseRow], v: &SparseRow, rows: &[Row], norms: &[f64], independent: &[usize], distance: f64, work: &mut Work) -> Option<Vec<(usize, f64)>> {
    let n = r.len();
    let first = through(r, v, rows, norms, independent, distance, work)?;
    let fitted = if first.within { first } else {
        // The rows that matter, fitted on their own.
        let chosen: Vec<usize> = first.coefficients.iter().map(|c| c.0).collect();
        fit(n, v, rows, norms, &chosen, distance, work)??
    };
    if !fitted.within { return None; }
    let mut support = fitted.coefficients;
    let scale = support.iter().fold(1.0, |m: f64, c| m.max(c.1.abs()));
    let mut unsure: Vec<Coefficient> = support.iter().copied().filter(|c| c.1.abs() <= f64::EPSILON / (CERTAIN * CERTAIN) * scale).collect();
    // Smallest first; there are rarely more than a few.
    while let Some(next) = (0..unsure.len()).reduce(|a, b| if unsure[b].1.abs() < unsure[a].1.abs() { b } else { a }) {
        let row = unsure.swap_remove(next).0;
        if !support.iter().any(|c| c.0 == row) { continue; }
        let rest: Vec<usize> = support.iter().map(|c| c.0).filter(|&i| i != row).collect();
        let refit = nearest(n, v, rows, norms, &rest, distance, work)?;
        if refit.within { support = refit.coefficients; }
        // Only a settled fit shows that the others cannot reproduce `v`.
        else if !refit.settled { return None; }
    }
    Some(support.iter().map(|&(i, high, low)| (i, high + low)).collect())
}

/// A row index and its coefficient in twice the working precision, as a rounded part and the
/// rest, so that combinations of rows with large coefficients that cancel are still exact.
type Coefficient = (usize, f64, f64);

struct Fitted {
    /// Without those too small to move the combination by `distance` together.
    coefficients: Vec<Coefficient>,
    /// The combination is within twice `distance` of `v`, its own and what was left out.
    within: bool,
    /// The fit stopped changing at the nearest combination, so one beyond that is the nearest
    /// there is.
    settled: bool,
}

/// The combination of the independent unit rows `subset` that reproduces `v`, or the nearest
/// one: first through a factor of them in the solve's column order, which fills no more than the
/// solve's own; when that does not reproduce it, by least squares on the rows themselves. `None`
/// when the work runs out or that factor would fill too much.
fn nearest(n: usize, v: &SparseRow, rows: &[Row], norms: &[f64], subset: &[usize], distance: f64, work: &mut Work) -> Option<Fitted> {
    work.spend(n)?;
    let mut r: Vec<SparseRow> = vec![Vec::new(); n];
    let mut factored = true;
    for &i in subset {
        match insert(&mut r, unit(&rows[i], norms[i]), distance, work) {
            Some(Insertion::Independent(_)) => {}
            _ if work.run_out() => return None,
            _ => { factored = false; break; }
        }
    }
    if factored {
        let first = through(&r, v, rows, norms, subset, distance, work)?;
        if first.within { return Some(first); }
    }
    match fit(n, v, rows, norms, subset, distance, work)? {
        Some(fitted) => Some(fitted),
        // Rows that were independent among more cannot be dependent among fewer, unless
        // rounding says so; nothing is shown then.
        None => Some(Fitted { coefficients: Vec::new(), within: false, settled: false }),
    }
}

/// The combination of the unit rows `subset` through `r`, a factor of them: `v = J^T a` for
/// `a = J z` and `R^T R z = v`. The seminormal equations take only the pivot columns, which can
/// be far worse conditioned than the rows, so a combination found within the distance is, but
/// one that is not shows nothing; it is never settled.
fn through(r: &[SparseRow], v: &SparseRow, rows: &[Row], norms: &[f64], subset: &[usize], distance: f64, work: &mut Work) -> Option<Fitted> {
    let step = |missing: &[f64], work: &mut Work| -> Option<Vec<f64>> {
        let z = seminormal(r, missing.to_vec(), work)?;
        work.spend(subset.iter().map(|&i| rows[i].entries.len()).sum())?;
        Some(subset.iter().map(|&i| rows[i].entries.iter().map(|&(k, x)| x * z[k]).sum::<f64>() / norms[i]).collect())
    };
    let fitted = refine(r.len(), v, rows, norms, subset, distance, work, &step)?;
    Some(Fitted { settled: false, ..fitted })
}

/// The combination of the unit rows `subset` nearest `v`, by least squares on the rows
/// themselves: their transpose is factored by rotations, `J^T = Q S`, and `S^T S a = J v` is
/// solved. Each correction shrinks the error by about `epsilon` times the squared condition of
/// the rows. A column shared by many rows fills `S` densely, so it is held to `work.fill`
/// entries. `Some(None)` when the rows are dependent; `None` when the work runs out or the
/// factor would hold more than that.
fn fit(n: usize, v: &SparseRow, rows: &[Row], norms: &[f64], subset: &[usize], distance: f64, work: &mut Work) -> Option<Option<Fitted>> {
    let mut columns: Vec<SparseRow> = vec![Vec::new(); n];
    for (j, &i) in subset.iter().enumerate() {
        for &(k, x) in &rows[i].entries { columns[k].push((j, x / norms[i])); }
    }
    work.spend(n + subset.iter().map(|&i| rows[i].entries.len()).sum::<usize>())?;
    let s = match transposed(columns, subset.len(), work)? {
        Transposed::Factor(s) => s,
        Transposed::Dependent => return Some(None),
        Transposed::Full => return None,
    };
    let step = |missing: &[f64], work: &mut Work| -> Option<Vec<f64>> {
        let b: Vec<f64> = subset.iter().map(|&i| rows[i].entries.iter().map(|&(k, x)| x / norms[i] * missing[k]).sum()).collect();
        seminormal(&s, b, work)
    };
    refine(n, v, rows, norms, subset, distance, work, &step).map(Some)
}

enum Transposed {
    Factor(Vec<SparseRow>),
    /// A row of `S` is empty: the rows are dependent.
    Dependent,
    /// `S` would hold more than `work.fill` entries.
    Full,
}

/// `S` of `A^T = Q S` by rotations, for `m` rows of `A` given by their `columns`: per column of
/// `A`, its `(row, entry)` pairs in increasing row order. A column shared by many rows fills `S`
/// densely, so it is held to `work.fill` entries. `None` when the work runs out.
fn transposed(mut columns: Vec<SparseRow>, m: usize, work: &mut Work) -> Option<Transposed> {
    // In order of their leads, which keeps the rows rotated in short.
    let mut leading: Vec<Vec<usize>> = vec![Vec::new(); m];
    for (k, column) in columns.iter().enumerate() {
        if let Some(&(j, _)) = column.first() { leading[j].push(k); }
    }
    let (mut s, mut held): (Vec<SparseRow>, usize) = (vec![Vec::new(); m], 0);
    for &k in leading.iter().flatten() {
        let mut rest = std::mem::take(&mut columns[k]);
        while let Some(&(j, _)) = rest.first() {
            if held.saturating_add(rest.len()) > work.fill { return Some(Transposed::Full); }
            if s[j].is_empty() { held += rest.len(); s[j] = rest; break; }
            let kept;
            (kept, rest) = rotate(&s[j], &rest, work)?;
            held = held - s[j].len() + kept.len();
            s[j] = kept;
        }
    }
    Some(if s.iter().any(|row| row.is_empty()) { Transposed::Dependent } else { Transposed::Factor(s) })
}

/// Coefficients of the unit rows `subset` for `v` from corrections by `step`, which turns what
/// the combination still misses of `v` into a change of coefficients; a correction is kept while
/// it shrinks the miss. Coefficients and misses are kept in twice the working precision, so a
/// combination found within the distance is, and terms that cancel cannot make up or hide a
/// miss. The fit is settled when its last correction, kept or not, moves the combination by
/// under a hundredth of `distance`.
fn refine(n: usize, v: &SparseRow, rows: &[Row], norms: &[f64], subset: &[usize], distance: f64, work: &mut Work, step: &dyn Fn(&[f64], &mut Work) -> Option<Vec<f64>>) -> Option<Fitted> {
    let mut coefficients: Vec<Coefficient> = subset.iter().map(|&i| (i, 0.0, 0.0)).collect();
    let mut missing = vec![0.0; n];
    for &(k, x) in v { missing[k] = x; }
    let (mut previous, mut change, mut size) = (f64::INFINITY, f64::INFINITY, 0.0);
    for _ in 0..12 {
        let delta = step(&missing, work)?;
        let trial: Vec<Coefficient> = coefficients.iter().zip(&delta).map(|(&(i, high, low), &d)| {
            let (sum, error) = two_sum(high, d);
            let (high, low) = two_sum(sum, error + low);
            (i, high, low)
        }).collect();
        let (miss, sizes) = rebuild(n, v, rows, norms, &trial, work)?;
        let norm = miss.iter().map(|x| x * x).sum::<f64>().sqrt();
        // How far this correction moves the combination, whether it is kept or not.
        change = miss.iter().zip(&missing).map(|(a, b)| (a - b) * (a - b)).sum::<f64>().sqrt();
        if norm >= previous { break; }
        size = sizes.iter().map(|x| x * x).sum::<f64>().sqrt();
        (coefficients, missing, previous) = (trial, miss, norm);
        if norm == 0.0 { change = 0.0; break; }
    }
    // What is left out moves the combination by at most `distance`, so twice that is allowed.
    let least = distance / subset.len().max(1) as f64;
    let kept: Vec<Coefficient> = coefficients.into_iter().filter(|c| (c.1 + c.2).abs() > least).collect();
    let (miss, _) = rebuild(n, v, rows, norms, &kept, work)?;
    let norm = miss.iter().map(|x| x * x).sum::<f64>().sqrt();
    let within = norm <= 2.0 * distance + 16.0 * f64::EPSILON * f64::EPSILON * size;
    Some(Fitted { coefficients: kept, within, settled: change <= distance / 100.0 })
}

/// Per column, what the combination `support` of unit rows misses of `v`, in twice the working
/// precision before its final rounding, and the sum of the sizes of its terms there.
fn rebuild(n: usize, v: &SparseRow, rows: &[Row], norms: &[f64], support: &[Coefficient], work: &mut Work) -> Option<(Vec<f64>, Vec<f64>)> {
    work.spend(n + support.iter().map(|&(i, ..)| rows[i].entries.len()).sum::<usize>())?;
    let (mut high, mut low, mut size) = (vec![0.0; n], vec![0.0; n], vec![0.0; n]);
    for &(k, x) in v { high[k] = x; size[k] = x.abs(); }
    for &(i, c, rest) in support {
        // The unit entries as `unit` rounds them, which are the rows the factor holds.
        for &(k, x) in &rows[i].entries {
            let entry = x / norms[i];
            let (term, error) = two_product(c, entry);
            let (sum, carried) = two_sum(high[k], -term);
            (high[k], low[k]) = (sum, low[k] + carried - error - rest * entry);
            size[k] += term.abs();
        }
    }
    Some((high.iter().zip(&low).map(|(h, l)| h + l).collect(), size))
}

/// `a + b` and its rounding error, exactly.
fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let sum = a + b;
    let part = sum - a;
    (sum, (a - (sum - part)) + (b - part))
}

/// `a b` and its rounding error, exactly barring overflow, by splitting each in halves.
fn two_product(a: f64, b: f64) -> (f64, f64) {
    let split = |x: f64| { let c = 134217729.0 * x; let high = c - (c - x); (high, x - high) };
    let (product, (ah, al), (bh, bl)) = (a * b, split(a), split(b));
    (product, ((ah * bh - product) + ah * bl + al * bh) + al * bl)
}

/// Most independent rows whose singular values are computed densely when the bound over the pivot
/// columns leaves rank unclear; with more, rank stays unclear.
const DENSE_RANK: usize = 32;

/// Most counted entries the checks past the linear bound may take, and the share of the work left
/// they may take at most: they only decide whether rank is clear, so they leave the rest to the
/// solve and the diagnosis around them. Past it, rank stays unclear.
const CHECK_WORK: usize = 64_000_000;
/// Most counted entries of those the rows of `T^-1` may take.
const INVERSE_WORK: usize = 20_000_000;

/// Whether the independent unit rows that `r` factors are clear of dependence: their smallest
/// singular value is at least `CERTAIN`. Leaving out the columns without pivots can only lower it,
/// so a lower bound over the pivot columns that reaches `CERTAIN` decides: first one in work
/// linear in their entries, then one from the rows of their inverse. A row whose lead is small
/// beside its entries in columns without pivots, as a nearly straight arm's, leaves the pivot
/// columns ill conditioned though the rows are not, so below both the rows' singular values are
/// computed: those of `S` in `R^T = Q S`, taken densely for at most `DENSE_RANK` rows and with an
/// absolute accuracy of about `epsilon`. More rows, an `S` that would hold more than `work.fill`
/// entries, or checks past the linear bound that would take more than `CHECK_WORK` or half the work
/// left, leave rank unclear. No estimate decides, since one from above can miss a weak direction
/// and call it clear. `None` when the linear bound runs out of work.
fn clear_of_dependence(r: &[SparseRow], work: &mut Work) -> Option<bool> {
    if comparison_floor(r, work)? >= CERTAIN { return Some(true); }
    let mut check = Work { done: 0, budget: CHECK_WORK.min(work.budget.saturating_sub(work.done) / 2), fill: work.fill, out: false };
    let clear = beyond_comparison(r, &mut check);
    work.done = work.done.saturating_add(check.done);
    Some(clear == Some(true))
}

/// Whether rank is clear by the rows of `T^-1` or by the rows' own singular values; `None` when
/// the work runs out. Each step is checked before it is taken, so the work spent stays within
/// `work.budget`.
fn beyond_comparison(r: &[SparseRow], work: &mut Work) -> Option<bool> {
    if inverse_floor(r, work)? >= CERTAIN { return Some(true); }
    let pivots: Vec<usize> = (0..r.len()).filter(|&k| !r[k].is_empty()).collect();
    let m = pivots.len();
    if m > DENSE_RANK { return Some(false); }
    let entries = r.len() + r.iter().map(|row| row.len()).sum::<usize>();
    work.afford(entries)?;
    let mut columns: Vec<SparseRow> = vec![Vec::new(); r.len()];
    for (j, &k) in pivots.iter().enumerate() {
        for &(c, x) in &r[k] { columns[c].push((j, x)); }
    }
    work.spend(entries)?;
    let Transposed::Factor(s) = transposed(columns, m, work)? else { return Some(false) };
    let mut dense = vec![vec![0.0; m]; m];
    for (j, row) in s.iter().enumerate() {
        for &(k, x) in row { dense[k][j] = x; }
    }
    // A decomposition that runs out used at most what it was allowed.
    let Some((values, _, spent)) = crate::dense::singular(&dense, work.budget.saturating_sub(work.done)) else {
        work.done = work.done.max(work.budget);
        return None;
    };
    work.spend(spent)?;
    Some(values.last().is_some_and(|&least| least >= CERTAIN))
}

/// `1 / sqrt(||C^-1||_1 ||C^-1||_inf)` for the comparison matrix `C` of `T`, the upper triangle of
/// `R` over the columns with pivots, with `|T_ii|` on its diagonal and `-|T_ij|` off it:
/// `|T^-1| <= C^-1` entrywise, so this bounds `1 / ||T^-1||_2`. `C^-1` is not negative, so its
/// norms are the largest entries of `C^-1 1` and `C^-T 1`, sums without cancellation, and the bound
/// allows for their rounding. It is far below the true value when entries of `T^-1` cancel, as
/// along a chain whose links alternate in sign.
fn comparison_floor(r: &[SparseRow], work: &mut Work) -> Option<f64> {
    let n = r.len();
    // `C z = 1` from the last pivot back, and `C^T w = 1` by rows of `C` from the first.
    let mut z = vec![0.0; n];
    for k in (0..n).rev() {
        let Some(&(_, pivot)) = r[k].first() else { continue };
        z[k] = (1.0 + r[k][1..].iter().map(|&(c, x)| x.abs() * z[c]).sum::<f64>()) / pivot.abs();
    }
    let mut w = vec![1.0; n];
    for k in 0..n {
        let Some(&(_, pivot)) = r[k].first() else { continue };
        w[k] /= pivot.abs();
        for &(c, x) in &r[k][1..] { w[c] += x.abs() * w[k]; }
    }
    let entries: usize = r.iter().map(|row| row.len()).sum();
    work.spend(2 * entries)?;
    // Columns without pivots take no part: `z` is zero there and `w` is not read.
    let largest = |v: &[f64]| (0..n).filter(|&k| !r[k].is_empty()).map(|k| v[k]).fold(0.0, f64::max);
    let widest = r.iter().map(|row| row.len()).max().unwrap_or(0);
    // Each computed sum solves `C` with entries moved by a relative `(widest + 2) epsilon`, which
    // can grow along `n` pivots.
    let slack = 1.0 + 4.0 * n as f64 * (widest + 2) as f64 * f64::EPSILON;
    let product = largest(&z) * largest(&w);
    Some(if product.is_finite() && slack < 1.01 { (product * slack * slack).sqrt().recip() } else { 0.0 })
}

/// `1 / ||T^-1||_F`, since `||T^-1||_2 <= ||T^-1||_F`, which is at most `sqrt(rank)` times larger.
/// Each row of `T^-1` comes from a triangular solve, backward stable, that visits only the pivots
/// it reaches, so a chain costs the square of its length. Zero once the bound falls below
/// `CERTAIN`; `None` when a row of `T` would pass `INVERSE_WORK` or the work allowance.
fn inverse_floor(r: &[SparseRow], work: &mut Work) -> Option<f64> {
    use std::{cmp::Reverse, collections::BinaryHeap};
    let n = r.len();
    let allowed = INVERSE_WORK.min(work.budget.saturating_sub(work.done));
    let (mut b, mut queued, mut reached) = (vec![0.0; n], vec![false; n], BinaryHeap::new());
    let (mut total, mut spent, limit) = (0.0, 0usize, (CERTAIN * CERTAIN).recip());
    for j in (0..n).filter(|&j| !r[j].is_empty()) {
        // `T^T y = e_j` by columns of `T^T`, the rows of `T`, in increasing pivot order.
        (b[j], queued[j]) = (1.0, true);
        reached.push(Reverse(j));
        while let Some(Reverse(k)) = reached.pop() {
            if spent + r[k].len() > allowed {
                work.done += spent;
                return None;
            }
            let y = b[k] / r[k][0].1;
            (b[k], queued[k]) = (0.0, false);
            total += y * y;
            spent += r[k].len();
            for &(c, x) in &r[k][1..] {
                if r[c].is_empty() { continue; }
                b[c] -= x * y;
                if !queued[c] { queued[c] = true; reached.push(Reverse(c)); }
            }
        }
        if !(total <= limit) { break; }
    }
    work.done += spent;
    Some(if total <= limit { total.sqrt().recip() } else { 0.0 })
}

/// Labels for equations with constraint `tags`, which never decrease, from the witnesses of all
/// groups by equation index; `None` when the work would pass `budget`. Witnesses of one
/// constraint can lie in several groups, as with the two axes of a coincidence, so equations are
/// set aside across all of them.
pub fn labels(tags: &[usize], witnesses: &[Witness], budget: usize) -> Option<Vec<u8>> {
    let mut work = Work { done: 0, budget, fill: usize::MAX, out: false };
    // Equations of each one's constraint; tags never decrease, so each constraint is one run.
    let mut multiplicity = vec![0; tags.len()];
    let mut first = 0;
    for i in 1..=tags.len() {
        if i == tags.len() || tags[i] != tags[first] {
            for m in &mut multiplicity[first..i] { *m = i - first; }
            first = i;
        }
    }
    let mut containing: Vec<Vec<usize>> = vec![Vec::new(); tags.len()];
    for (w, witness) in witnesses.iter().enumerate() {
        for &i in &witness.rows { containing[i].push(w); }
    }
    let (mut covered, mut aside) = (vec![false; witnesses.len()], vec![false; tags.len()]);
    let mut present = vec![false; tags.len() + 1];
    for &m in &multiplicity { present[m] = true; }
    for m in (1..present.len()).filter(|&m| present[m]) {
        // Constraints from the last, and the equations of each in order.
        let mut end = tags.len();
        while end > 0 {
            let start = end - multiplicity[end - 1];
            if multiplicity[start] == m {
                for i in start..end {
                    if containing[i].iter().any(|&w| !covered[w]) {
                        aside[i] = true;
                        for &w in &containing[i] { covered[w] = true; }
                    }
                }
            }
            end = start;
        }
        work.spend(tags.len() + containing.iter().map(|list| list.len()).sum::<usize>())?;
    }
    let redundant: Vec<bool> = (0..tags.len()).map(|i| aside[i] && containing[i].iter().all(|&w| witnesses[w].agrees)).collect();
    let mut labels = vec![0; tags.len()];
    let mut conflicting = vec![false; tags.len()];
    for witness in witnesses {
        if !witness.rows.iter().any(|&i| redundant[i]) {
            for &i in &witness.rows { conflicting[i] = true; }
        }
    }
    for i in 0..tags.len() { if redundant[i] { labels[i] = REDUNDANT; } }
    // A constraint conflicts through any of its equations.
    let mut first = 0;
    for i in 1..=tags.len() {
        if i == tags.len() || tags[i] != tags[first] {
            if conflicting[first..i].iter().any(|&c| c) { for label in &mut labels[first..i] { *label = CONFLICTING; } }
            first = i;
        }
    }
    Some(labels)
}
