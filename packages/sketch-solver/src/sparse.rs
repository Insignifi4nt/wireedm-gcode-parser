//! Sparse least squares by row Givens rotations. Rows keep their given order; columns take a
//! minimum-degree order fixed by structure, so fill stays near that of a band or a tree. Work is
//! counted in entries written and stops at a budget, since native code cannot be interrupted.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// One sparse row: `(position, value)` pairs sorted by position, without zeros.
pub type SparseRow = Vec<(usize, f64)>;

/// A minimum-degree elimination of the column graph, where columns sharing a row are adjacent.
pub struct Ordering {
    /// Position of each column. Ties take the lowest column, so the order is deterministic.
    pub position: Vec<usize>,
    /// Entries `R` can hold: each column fills its own row and one entry for each neighbor left
    /// when it is eliminated.
    pub fill: usize,
    /// Adjacency entries written.
    pub work: usize,
}

/// The ordering, or `None` as soon as its fill must exceed `fill_limit` or its work `work_limit`.
/// Edges never disappear before one of their columns is eliminated, so the fill so far, the edges
/// still present and the diagonals still to come bound the final fill from below, and adjacency
/// memory stays within about twice the fill limit. Lists are built distinct one column at a time
/// from the rows each column is in, so repeated rows cost work but no adjacency memory.
pub fn minimum_degree<R: AsRef<[usize]>>(n: usize, rows: &[R], fill_limit: usize, work_limit: usize) -> Option<Ordering> {
    let mut incident: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, row) in rows.iter().enumerate() {
        for &a in row.as_ref() { incident[a].push(i); }
    }
    let mut adjacent: Vec<Vec<usize>> = vec![Vec::new(); n];
    // `seen[b] == stamp` marks `b` as already in the list being built, so lists need no sorting.
    let (mut seen, mut stamp) = (vec![0; n], 0);
    let (mut live, mut fill, mut work) = (0usize, 0usize, 0usize);
    let exceeded = |fill: usize, live: usize, left: usize, work: usize|
        fill.saturating_add(live / 2).saturating_add(left) > fill_limit || work > work_limit;
    for (a, list) in adjacent.iter_mut().enumerate() {
        stamp += 1;
        seen[a] = stamp;
        for &i in &incident[a] {
            let row = rows[i].as_ref();
            work = work.saturating_add(row.len());
            for &b in row { if seen[b] != stamp { seen[b] = stamp; list.push(b); } }
        }
        live += list.len();
        if exceeded(fill, live, n, work) { return None; }
    }
    drop(incident);
    let mut distinct = |list: &mut Vec<usize>| {
        stamp += 1;
        list.retain(|&b| seen[b] != stamp && { seen[b] = stamp; true });
    };
    let mut position = vec![usize::MAX; n];
    // Stale entries, whose degree has changed since they were pushed, are skipped when popped.
    let mut queue: BinaryHeap<Reverse<(usize, usize)>> = (0..n).map(|k| Reverse((adjacent[k].len(), k))).collect();
    let mut step = 0;
    while let Some(Reverse((degree, next))) = queue.pop() {
        if position[next] != usize::MAX || degree != adjacent[next].len() { continue; }
        position[next] = step;
        step += 1;
        let neighbors = std::mem::take(&mut adjacent[next]);
        fill += 1 + neighbors.len();
        live -= neighbors.len();
        for &a in &neighbors {
            // Eliminating `next` joins its remaining neighbors into a clique.
            let list = &mut adjacent[a];
            live -= list.len();
            work = work.saturating_add(list.len() + neighbors.len());
            list.retain(|&b| b != next);
            list.extend(neighbors.iter().copied().filter(|&b| b != a));
            distinct(list);
            live += list.len();
            queue.push(Reverse((list.len(), a)));
            if work > work_limit { return None; }
        }
        // Lists are symmetric again only once every neighbor has been rewritten.
        if exceeded(fill, live, n - step, work) { return None; }
    }
    Some(Ordering { position, fill, work })
}

/// `minimum_degree` within `work_limit` with its heap steps counted too. Each column's heap entry,
/// and each degree update's, takes about `depth` steps to push and pop; updates number at most the
/// adjacency work, so the ordering gets what is left after the columns' share, cut by that factor,
/// and is charged for both before they run.
pub fn minimum_degree_with_heap<R: AsRef<[usize]>>(n: usize, rows: &[R], fill_limit: usize, work_limit: usize) -> Option<Ordering> {
    let depth = 2 * ((usize::BITS - n.saturating_add(work_limit).leading_zeros()) as usize + 1);
    let columns = n.saturating_mul(1 + depth);
    let mut ordering = minimum_degree(n, rows, fill_limit, work_limit.checked_sub(columns)? / (1 + depth))?;
    ordering.work = columns + ordering.work * (1 + depth);
    Some(ordering)
}

/// Upper-triangular `R` by rows (row `k` starts at position `k`) and `c = Q^T b`.
#[derive(Clone)]
pub struct Factor {
    pub rows: Vec<SparseRow>,
    pub c: Vec<f64>,
    /// Entries written, at most one rotation step past `budget`.
    pub work: usize,
    /// Most rotations any one incoming row took, which scales the factor's backward error.
    pub depth: usize,
    budget: usize,
    scratch: (SparseRow, SparseRow),
}

impl Factor {
    /// An empty factor of `n` columns that may write about `budget` entries.
    pub fn new(n: usize, budget: usize) -> Factor {
        Factor { rows: vec![Vec::new(); n], c: vec![0.0; n], work: 0, depth: 0, budget, scratch: (Vec::new(), Vec::new()) }
    }

    /// Rotates row `v` with right-hand side `beta` into the factor. A row reaching an empty pivot
    /// fills it. `false` when the budget ran out first, which leaves the factor unusable.
    pub fn rotate(&mut self, mut v: SparseRow, mut beta: f64) -> bool {
        let mut rotations = 0;
        while let Some(&(k, lead)) = v.first() {
            if self.work > self.budget { return false; }
            let row = &mut self.rows[k];
            if row.is_empty() {
                self.work = self.work.saturating_add(v.len());
                *row = v;
                self.c[k] = beta;
                return true;
            }
            let pivot = row[0].1;
            rotations += 1;
            self.depth = self.depth.max(rotations);
            // Scaled, so entries whose squares underflow still rotate.
            let big = pivot.abs().max(lead.abs());
            let radius = big * ((pivot / big).powi(2) + (lead / big).powi(2)).sqrt();
            let (cos, sin) = (pivot / radius, lead / radius);
            let (r, w) = (&mut self.scratch.0, &mut self.scratch.1);
            r.clear();
            w.clear();
            r.push((k, radius));
            let (mut i, mut j) = (1, 1);
            while i < row.len() || j < v.len() {
                let column = row.get(i).map_or(usize::MAX, |e| e.0).min(v.get(j).map_or(usize::MAX, |e| e.0));
                let x = if row.get(i).is_some_and(|e| e.0 == column) { i += 1; row[i - 1].1 } else { 0.0 };
                let y = if v.get(j).is_some_and(|e| e.0 == column) { j += 1; v[j - 1].1 } else { 0.0 };
                let (a, b) = (cos * x + sin * y, cos * y - sin * x);
                if a != 0.0 { r.push((column, a)); }
                if b != 0.0 { w.push((column, b)); }
            }
            self.work = self.work.saturating_add(r.len() + w.len());
            std::mem::swap(row, r);
            std::mem::swap(&mut v, w);
            let a = self.c[k];
            self.c[k] = cos * a + sin * beta;
            beta = cos * beta - sin * a;
        }
        true
    }

    /// `sqrt(mu) I` with a zero right-hand side, so rotating in `[J | b]` factors `[J; sqrt(mu) I]`.
    /// Damping goes in first because a row meeting a diagonal-only row carries on with only its
    /// own later entries, so most rows stop near their own length. Rotated in after `J`, as in
    /// MINPACK, each damping row would run the depth of the elimination tree, the whole group
    /// for a chain. Dependent rows whose right-hand sides disagree, as conflicting equations
    /// always do and redundant ones of different form may before convergence, make the step's
    /// motion along directions `J` leaves free depend on roundoff in that order.
    pub fn damped(n: usize, mu: f64, budget: usize) -> Factor {
        let mut factor = Factor::new(n, budget);
        if mu > 0.0 { for (k, row) in factor.rows.iter_mut().enumerate() { *row = vec![(k, mu.sqrt())]; } }
        factor.work = n;
        factor
    }

    /// `x` with `R x = c` by positions; `None` when a pivot is missing or the result not finite.
    pub fn solve(&self) -> Option<Vec<f64>> { self.solve_with(&self.c) }

    /// `x` with `R x = c` for another right-hand side `c`, by positions.
    pub fn solve_with(&self, c: &[f64]) -> Option<Vec<f64>> {
        let n = c.len();
        let mut x = vec![0.0; n];
        for k in (0..n).rev() {
            let row = &self.rows[k];
            let &(first, pivot) = row.first()?;
            if first != k { return None; }
            let mut sum = c[k];
            for &(j, value) in &row[1..] { sum -= value * x[j]; }
            x[k] = sum / pivot;
        }
        x.iter().all(|value| value.is_finite()).then_some(x)
    }

    /// `y` with `R^T y = b` by positions; `None` when a pivot is missing or the result not finite.
    pub fn solve_transposed(&self, b: &[f64]) -> Option<Vec<f64>> {
        let mut y = b.to_vec();
        for k in 0..y.len() {
            let row = &self.rows[k];
            let &(first, pivot) = row.first()?;
            if first != k { return None; }
            y[k] /= pivot;
            let value = y[k];
            for &(j, entry) in &row[1..] { y[j] -= entry * value; }
        }
        y.iter().all(|value| value.is_finite()).then_some(y)
    }
}
