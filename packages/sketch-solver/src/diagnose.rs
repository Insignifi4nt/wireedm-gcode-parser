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
//! as conflicting.
//!
//! Near a singular configuration, as a point a little off where its circle touches its line, rank
//! at `TAU` is unclear for a solved sketch too. A row whose insertion or witness cannot be decided
//! is left out, which leaves the factor as it was, so later rows are decided as before; the
//! diagnosis is then not `certain`, and neither is one whose independent rows are not shown to
//! have a smallest singular value of at least `CERTAIN`. Its witnesses are dependencies found, but more may exist, so freedom is
//! unknown.

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
    let mut work = Work { done: 0, budget, fill };
    let found = diagnose_within(n, rows, distance, &mut work);
    (found, work.done)
}

fn diagnose_within(n: usize, rows: &[Row], distance: f64, work: &mut Work) -> Option<Diagnosis> {
    let mut r: Vec<SparseRow> = vec![Vec::new(); n];
    let mut rank = 0;
    // Each dependent row with the earlier rows of its witness.
    let mut witnesses: Vec<(usize, Vec<(usize, f64)>)> = Vec::new();
    let norms: Vec<f64> = rows.iter().map(|row| row.entries.iter().map(|e| e.1 * e.1).sum::<f64>().sqrt()).collect();
    let (mut independent, mut certain) = (Vec::new(), true);
    for (index, row) in rows.iter().enumerate() {
        if !row.residual.is_finite() || !norms[index].is_finite() { return None; }
        if norms[index] == 0.0 { witnesses.push((index, Vec::new())); continue; }
        let unit = unit(row, norms[index]);
        let decided = match insert(&mut r, unit.clone(), distance, work) {
            Some(Insertion::Independent) => { rank += 1; independent.push(index); true }
            Some(Insertion::Dependent) => witness(&r, &unit, rows, &norms, &independent, distance, work)
                .map(|support| witnesses.push((index, support))).is_some(),
            None => false,
        };
        if !decided {
            if work.done > work.budget { return None; }
            certain = false;
        }
    }
    if rank > 0 && !clear_of_dependence(&r, work)? { certain = false; }
    // A unit row's residual, or the residual itself for a row without unknowns.
    let scaled = |i: usize, value: f64| if norms[i] > 0.0 { value / norms[i] } else { value };
    let witnesses = witnesses.into_iter().map(|(j, support)| {
        let combined = support.iter().map(|&(i, c)| c * scaled(i, rows[i].residual)).sum::<f64>() - scaled(j, rows[j].residual);
        let bound = support.iter().map(|&(i, c)| c.abs() * scaled(i, rows[i].tolerance)).sum::<f64>() + scaled(j, rows[j].tolerance);
        Witness { rows: support.iter().map(|s| s.0).chain([j]).collect(), agrees: combined.abs() <= bound }
    }).collect();
    Some(Diagnosis { rank, witnesses, certain })
}

/// How many of `rows`, zero rows included, lie within `distance` of the span of earlier ones once
/// normalized, and the work spent; no singular value gate applies. `None` when a row's dependence
/// cannot be decided or the work would pass `budget`.
pub fn dependent_count(n: usize, rows: &[SparseRow], distance: f64, budget: usize) -> (Option<usize>, usize) {
    let mut work = Work { done: 0, budget, fill: usize::MAX };
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
    (found, work.done)
}

/// Indices of the nonzero `rows` within `TAU` of the span of earlier ones once normalized, and
/// the work spent; `None` when rank cannot be decided reliably or the work would pass `budget`.
/// A factor that rank is checked through holds at most `fill` entries.
pub fn dependent(n: usize, rows: &[SparseRow], budget: usize, fill: usize) -> (Option<Vec<usize>>, usize) {
    let mut work = Work { done: 0, budget, fill };
    let found = (|| {
        let (mut r, mut rank, mut dependent) = (vec![Vec::new(); n], 0, Vec::new());
        for (index, row) in rows.iter().enumerate() {
            let norm = row.iter().map(|e| e.1 * e.1).sum::<f64>().sqrt();
            if !norm.is_finite() { return None; }
            if norm == 0.0 { continue; }
            match insert(&mut r, row.iter().map(|&(k, x)| (k, x / norm)).collect(), TAU, &mut work)? {
                Insertion::Independent => rank += 1,
                Insertion::Dependent => dependent.push(index),
            }
        }
        if rank > 0 && !clear_of_dependence(&r, &mut work)? { return None; }
        Some(dependent)
    })();
    (found, work.done)
}

fn unit(row: &Row, norm: f64) -> SparseRow { row.entries.iter().map(|&(k, x)| (k, x / norm)).collect() }

/// Entries written so far against `budget`, and the entries a witness fit's factor may hold.
struct Work { done: usize, budget: usize, fill: usize }

impl Work {
    fn spend(&mut self, entries: usize) -> Option<()> {
        self.done = self.done.saturating_add(entries);
        (self.done <= self.budget).then_some(())
    }
}

enum Insertion { Independent, Dependent }

/// Rotates `v` into `r`. A remainder reaching an empty pivot claims it when its lead exceeds
/// `distance`, and otherwise drops that lead and goes on. A row whose dropped leads stay within
/// `distance` is dependent and leaves `r` as it was; `None` when they do not, since rank is then
/// unclear.
fn insert(r: &mut [SparseRow], mut v: SparseRow, distance: f64, work: &mut Work) -> Option<Insertion> {
    let (mut undo, mut dropped) = (Vec::new(), 0.0);
    while let Some(&(k, lead)) = v.first() {
        if r[k].is_empty() {
            if lead.abs() > distance {
                r[k] = v;
                return Some(Insertion::Independent);
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
/// the rotated row and what is left of `v`; `None` when the work runs out.
fn rotate(row: &SparseRow, v: &SparseRow, work: &mut Work) -> Option<(SparseRow, SparseRow)> {
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
            Some(Insertion::Independent) => {}
            _ if work.done > work.budget => return None,
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

/// Whether the independent unit rows that `r` factors are clear of dependence: their smallest
/// singular value is at least `CERTAIN`. Leaving out the columns without pivots can only lower it,
/// so a lower bound over the pivot columns that reaches `CERTAIN` decides. A row whose lead is
/// small beside its entries in columns without pivots, as a nearly straight arm's, leaves the pivot
/// columns ill conditioned though the rows are not, so below it the rows' singular values are
/// computed: those of `S` in `R^T = Q S`, taken densely for at most `DENSE_RANK` rows and with an
/// absolute accuracy of about `epsilon`. More rows, or an `S` that would hold more than `work.fill`
/// entries, leave rank unclear. No estimate decides, since one from above can miss a weak
/// direction and call it clear. `None` when the work runs out.
fn clear_of_dependence(r: &[SparseRow], work: &mut Work) -> Option<bool> {
    if floor_over_pivots(r, work)? >= CERTAIN { return Some(true); }
    let pivots: Vec<usize> = (0..r.len()).filter(|&k| !r[k].is_empty()).collect();
    let m = pivots.len();
    if m > DENSE_RANK { return Some(false); }
    let mut columns: Vec<SparseRow> = vec![Vec::new(); r.len()];
    for (j, &k) in pivots.iter().enumerate() {
        for &(c, x) in &r[k] { columns[c].push((j, x)); }
    }
    work.spend(r.len() + r.iter().map(|row| row.len()).sum::<usize>())?;
    let Transposed::Factor(s) = transposed(columns, m, work)? else { return Some(false) };
    let mut dense = vec![vec![0.0; m]; m];
    for (j, row) in s.iter().enumerate() {
        for &(k, x) in row { dense[k][j] = x; }
    }
    let Some((values, _, spent)) = crate::dense::singular(&dense, work.budget.saturating_sub(work.done)) else {
        work.done = work.budget.saturating_add(1);
        return None;
    };
    work.spend(spent)?;
    Some(values.last().is_some_and(|&least| least >= CERTAIN))
}

/// A lower bound on the smallest singular value of `R` over the columns with pivots, the upper
/// triangle `T`: `1 / ||T^-1||_F`, since `||T^-1||_2 <= ||T^-1||_F`, which is at most `sqrt(rank)`
/// times larger. Each row of `T^-1` comes from a triangular solve, backward stable, that visits
/// only the pivots it reaches. Zero once the bound falls below `CERTAIN`; `None` when the work runs
/// out.
fn floor_over_pivots(r: &[SparseRow], work: &mut Work) -> Option<f64> {
    use std::{cmp::Reverse, collections::BinaryHeap};
    let n = r.len();
    let (mut b, mut queued, mut reached) = (vec![0.0; n], vec![false; n], BinaryHeap::new());
    let (mut total, limit) = (0.0, (CERTAIN * CERTAIN).recip());
    for j in (0..n).filter(|&j| !r[j].is_empty()) {
        // `T^T y = e_j` by columns of `T^T`, the rows of `T`, in increasing pivot order.
        (b[j], queued[j]) = (1.0, true);
        reached.push(Reverse(j));
        let mut entries = 0;
        while let Some(Reverse(k)) = reached.pop() {
            let y = b[k] / r[k][0].1;
            (b[k], queued[k]) = (0.0, false);
            total += y * y;
            entries += r[k].len();
            for &(c, x) in &r[k][1..] {
                if r[c].is_empty() { continue; }
                b[c] -= x * y;
                if !queued[c] { queued[c] = true; reached.push(Reverse(c)); }
            }
        }
        work.spend(entries)?;
        if !(total <= limit) { return Some(0.0); }
    }
    Some(total.sqrt().recip())
}

/// Labels for equations with constraint `tags`, which never decrease, from the witnesses of all
/// groups by equation index; `None` when the work would pass `budget`. Witnesses of one
/// constraint can lie in several groups, as with the two axes of a coincidence, so equations are
/// set aside across all of them.
pub fn labels(tags: &[usize], witnesses: &[Witness], budget: usize) -> Option<Vec<u8>> {
    let mut work = Work { done: 0, budget, fill: usize::MAX };
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
