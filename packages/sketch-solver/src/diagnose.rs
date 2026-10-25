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

use crate::sparse::SparseRow;

/// Distance from the span of earlier rows, for rows of unit norm, below which a row is dependent.
pub const TAU: f64 = 1e-10;
/// Smallest singular value estimate of the independent rows below which rank is not certain.
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
}

/// A dependent row with the earlier rows that reproduce it.
pub struct Witness {
    /// Row indices in increasing order, the dependent row last.
    pub rows: Vec<usize>,
    /// The same combination of residuals is within the rows' tolerances.
    pub agrees: bool,
}

/// The diagnosis of `rows` over `n` columns, with a row dependent within `distance` (`TAU` or
/// `STALLED`) of the span of earlier ones, and the work spent; `None` when rank cannot be decided
/// reliably or the work would pass `budget` entries.
pub fn diagnose(n: usize, rows: &[Row], distance: f64, budget: usize) -> (Option<Diagnosis>, usize) {
    let mut work = Work { done: 0, budget };
    let found = diagnose_within(n, rows, distance, &mut work);
    (found, work.done)
}

fn diagnose_within(n: usize, rows: &[Row], distance: f64, work: &mut Work) -> Option<Diagnosis> {
    let mut r: Vec<SparseRow> = vec![Vec::new(); n];
    let mut rank = 0;
    // Each dependent row with the earlier rows of its witness.
    let mut witnesses: Vec<(usize, Vec<(usize, f64)>)> = Vec::new();
    let norms: Vec<f64> = rows.iter().map(|row| row.entries.iter().map(|e| e.1 * e.1).sum::<f64>().sqrt()).collect();
    let mut independent = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        if !row.residual.is_finite() || !norms[index].is_finite() { return None; }
        if norms[index] == 0.0 { witnesses.push((index, Vec::new())); continue; }
        let unit = unit(row, norms[index]);
        match insert(&mut r, unit.clone(), distance, work)? {
            Insertion::Independent => { rank += 1; independent.push(index); }
            Insertion::Dependent => witnesses.push((index, witness(&r, &unit, rows, &norms, &independent, distance, work)?)),
        }
    }
    if rank > 0 && smallest_singular_value(&r, work)? < CERTAIN { return None; }
    // A unit row's residual, or the residual itself for a row without unknowns.
    let scaled = |i: usize, value: f64| if norms[i] > 0.0 { value / norms[i] } else { value };
    let witnesses = witnesses.into_iter().map(|(j, support)| {
        let combined = support.iter().map(|&(i, c)| c * scaled(i, rows[i].residual)).sum::<f64>() - scaled(j, rows[j].residual);
        let bound = support.iter().map(|&(i, c)| c.abs() * scaled(i, rows[i].tolerance)).sum::<f64>() + scaled(j, rows[j].tolerance);
        Witness { rows: support.iter().map(|s| s.0).chain([j]).collect(), agrees: combined.abs() <= bound }
    }).collect();
    Some(Diagnosis { rank, witnesses })
}

/// Indices of the nonzero `rows` within `TAU` of the span of earlier ones once normalized, and
/// the work spent; `None` when rank cannot be decided reliably or the work would pass `budget`.
pub fn dependent(n: usize, rows: &[SparseRow], budget: usize) -> (Option<Vec<usize>>, usize) {
    let mut work = Work { done: 0, budget };
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
        if rank > 0 && smallest_singular_value(&r, &mut work)? < CERTAIN { return None; }
        Some(dependent)
    })();
    (found, work.done)
}

fn unit(row: &Row, norm: f64) -> SparseRow { row.entries.iter().map(|&(k, x)| (k, x / norm)).collect() }

struct Work { done: usize, budget: usize }

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
        let row = &r[k];
        let pivot = row[0].1;
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
        undo.push((k, std::mem::replace(&mut r[k], kept)));
        v = rest;
    }
    for (k, row) in undo.into_iter().rev() { r[k] = row; }
    (dropped.sqrt() <= distance).then_some(Insertion::Dependent)
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

/// Coefficients over the earlier independent unit rows that reproduce `v`, which lies in their
/// span. Coefficients too small to move the combination by `distance` together, as much as a
/// dependent row may differ from it, are left out.
/// The rows are independent, so the coefficients are unique, but over nearly dependent rows they
/// carry roundoff of up to about `epsilon / CERTAIN^2` relatively; a row whose coefficient is
/// that small stays only when the others do not reproduce `v` within `distance` without it.
/// `None` when the rows left do not reproduce it within twice `distance`, its own and what was
/// left out, and the roundoff of the combination: an insertion's remainder shrinks with the earlier pivots, so a row far from the
/// span of rows with small pivots can look dependent, and rank is then unclear.
fn witness(r: &[SparseRow], v: &SparseRow, rows: &[Row], norms: &[f64], independent: &[usize], distance: f64, work: &mut Work) -> Option<Vec<(usize, f64)>> {
    let coefficients = coefficients(r, v, rows, norms, independent, work)?;
    let scale = coefficients.iter().fold(1.0, |m: f64, c| m.max(c.1.abs()));
    let least = distance / coefficients.len().max(1) as f64;
    let mut support: Vec<(usize, f64)> = coefficients.into_iter().filter(|c| c.1.abs() > least).collect();
    let mut unsure: Vec<(usize, f64)> = support.iter().copied().filter(|c| c.1.abs() <= f64::EPSILON / (CERTAIN * CERTAIN) * scale).collect();
    // Smallest first; there are rarely more than a few.
    while let Some(next) = (0..unsure.len()).reduce(|a, b| if unsure[b].1.abs() < unsure[a].1.abs() { b } else { a }) {
        let row = unsure.swap_remove(next).0;
        let rest: Vec<usize> = support.iter().map(|c| c.0).filter(|&i| i != row).collect();
        if let Some(refit) = refit(r.len(), v, rows, norms, &rest, distance, work)? { support = refit; }
    }
    reproduces(r.len(), v, rows, norms, &support, distance, work)?.then_some(support)
}

/// The combination `support` of unit rows is within `2 distance` of `v`, plus its own
/// roundoff, in every column; `None` when the work runs out.
fn reproduces(n: usize, v: &SparseRow, rows: &[Row], norms: &[f64], support: &[(usize, f64)], distance: f64, work: &mut Work) -> Option<bool> {
    work.spend(n + support.iter().map(|&(i, _)| rows[i].entries.len()).sum::<usize>())?;
    let mut rebuilt = vec![0.0; n];
    for &(i, c) in support {
        for &(k, x) in &rows[i].entries { rebuilt[k] += c * x / norms[i]; }
    }
    for &(k, x) in v { rebuilt[k] -= x; }
    let roundoff = 8.0 * f64::EPSILON * (1.0 + support.iter().map(|c| c.1.abs()).sum::<f64>());
    Some(rebuilt.iter().all(|x| x.abs() <= 2.0 * distance + roundoff))
}

/// Coefficients over the independent unit rows of `r`, by row index in `independent`, of the
/// combination nearest `v`: with those rows `J = Q R`, `v = J^T a` for `a = J z` and `R^T R z = v`.
fn coefficients(r: &[SparseRow], v: &SparseRow, rows: &[Row], norms: &[f64], independent: &[usize], work: &mut Work) -> Option<Vec<(usize, f64)>> {
    let mut a = vec![0.0; r.len()];
    for &(k, x) in v { a[k] = x; }
    let z = seminormal(r, a, work)?;
    work.spend(independent.iter().map(|&i| rows[i].entries.len()).sum())?;
    Some(independent.iter().map(|&i| (i, rows[i].entries.iter().map(|&(k, x)| x * z[k]).sum::<f64>() / norms[i])).collect())
}

/// Coefficients over `subset`, independent rows, when `v` is clearly within `distance` of their
/// span and they reproduce it, in a fresh factor over `n` columns; `Some(None)` when it is not or that is unclear,
/// `None` when the work runs out.
fn refit(n: usize, v: &SparseRow, rows: &[Row], norms: &[f64], subset: &[usize], distance: f64, work: &mut Work) -> Option<Option<Vec<(usize, f64)>>> {
    work.spend(n)?;
    let mut r: Vec<SparseRow> = vec![Vec::new(); n];
    // Fewer earlier rows only leave each further from their span, so each stays independent.
    for &i in subset.iter() {
        match insert(&mut r, unit(&rows[i], norms[i]), distance, work) {
            Some(Insertion::Independent) => {}
            _ if work.done > work.budget => return None,
            _ => return Some(None),
        }
    }
    match insert(&mut r, v.clone(), distance, work) {
        Some(Insertion::Dependent) => {
            let refit = coefficients(&r, v, rows, norms, subset, work)?;
            Some(reproduces(n, v, rows, norms, &refit, distance, work)?.then_some(refit))
        }
        _ if work.done > work.budget => None,
        _ => Some(None),
    }
}

/// Estimate of the smallest singular value of `R` over the columns with pivots, by four inverse
/// iterations on `R^T R` from a fixed start. Inverse iteration approaches it from above, so this
/// is an estimate, not a certificate. Leaving out the columns without pivots can only lower the
/// value, so a row whose lead is small beside its entries in free columns, between `TAU` and
/// `CERTAIN` of its norm, makes rank look unclear although it is not.
fn smallest_singular_value(r: &[SparseRow], work: &mut Work) -> Option<f64> {
    let mut x: Vec<f64> = (0..r.len()).map(|k| if r[k].is_empty() { 0.0 } else if k % 2 == 0 { 1.0 } else { -0.7 }).collect();
    let mut estimate = f64::INFINITY;
    for _ in 0..4 {
        let norm = x.iter().map(|v| v * v).sum::<f64>().sqrt();
        if norm == 0.0 || !norm.is_finite() { return Some(0.0); }
        for v in &mut x { *v /= norm; }
        let z = seminormal(r, x, work)?;
        let grown = z.iter().map(|v| v * v).sum::<f64>().sqrt();
        estimate = if grown > 0.0 { grown.sqrt().recip() } else { f64::INFINITY };
        x = z;
    }
    Some(estimate)
}

/// Labels for equations with constraint `tags`, which never decrease, from the witnesses of all
/// groups by equation index; `None` when the work would pass `budget`. Witnesses of one
/// constraint can lie in several groups, as with the two axes of a coincidence, so equations are
/// set aside across all of them.
pub fn labels(tags: &[usize], witnesses: &[Witness], budget: usize) -> Option<Vec<u8>> {
    let mut work = Work { done: 0, budget };
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
