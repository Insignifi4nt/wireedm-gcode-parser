//! Sparse least squares by row Givens rotations. Rows keep their given order; columns take a
//! minimum-degree order fixed by structure, so fill stays near that of a band or a tree.

use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// One sparse row: `(position, value)` pairs sorted by position, without zeros.
pub type SparseRow = Vec<(usize, f64)>;

/// Position of each column in a minimum-degree elimination of the column graph, where columns
/// sharing a row are adjacent, and the number of entries this leaves room for in `R`: each column
/// fills its own row and one entry for each neighbor left when it is eliminated. Ties take the
/// lowest column, so the order is deterministic.
pub fn minimum_degree(n: usize, rows: impl Iterator<Item = impl AsRef<[usize]>>) -> (Vec<usize>, usize) {
    let mut adjacent: Vec<Vec<usize>> = vec![Vec::new(); n];
    for row in rows {
        let row = row.as_ref();
        for &a in row { for &b in row { if a != b { adjacent[a].push(b); } } }
    }
    // `seen[b] == stamp` marks `b` as already in the list being built, so lists need no sorting.
    let (mut seen, mut stamp) = (vec![0; n], 0);
    let mut distinct = |list: &mut Vec<usize>| {
        stamp += 1;
        list.retain(|&b| seen[b] != stamp && { seen[b] = stamp; true });
    };
    for list in &mut adjacent { distinct(list); }
    let mut position = vec![usize::MAX; n];
    // Stale entries, whose degree has changed since they were pushed, are skipped when popped.
    let mut queue: BinaryHeap<Reverse<(usize, usize)>> = (0..n).map(|k| Reverse((adjacent[k].len(), k))).collect();
    let (mut step, mut fill) = (0, 0);
    while let Some(Reverse((degree, next))) = queue.pop() {
        if position[next] != usize::MAX || degree != adjacent[next].len() { continue; }
        position[next] = step;
        step += 1;
        let neighbors = std::mem::take(&mut adjacent[next]);
        fill += 1 + neighbors.len();
        for &a in &neighbors {
            // Eliminating `next` joins its remaining neighbors into a clique.
            let list = &mut adjacent[a];
            list.retain(|&b| b != next);
            list.extend(neighbors.iter().copied().filter(|&b| b != a));
            distinct(list);
            queue.push(Reverse((adjacent[a].len(), a)));
        }
    }
    (position, fill)
}

/// Upper-triangular `R` by rows (row `k` starts at position `k`) and `c = Q^T b`.
pub struct Factor {
    pub rows: Vec<SparseRow>,
    pub c: Vec<f64>,
    /// Entries updated by rotations, a measure of the work done.
    pub work: usize,
    scratch: (SparseRow, SparseRow),
}

impl Factor {
    /// `sqrt(mu) I` with a zero right-hand side, so rotating in `[J | b]` factors
    /// `[J; sqrt(mu) I]` at the cost of factoring `J` alone; `mu = 0` starts empty.
    pub fn damped(n: usize, mu: f64) -> Factor {
        let rows = (0..n).map(|k| if mu > 0.0 { vec![(k, mu.sqrt())] } else { Vec::new() }).collect();
        Factor { rows, c: vec![0.0; n], work: 0, scratch: (Vec::new(), Vec::new()) }
    }

    /// Rotates row `v` with right-hand side `beta` into the factor. A row reaching an empty pivot,
    /// possible only when `mu = 0`, fills it.
    pub fn rotate(&mut self, mut v: SparseRow, mut beta: f64) {
        while let Some(&(k, lead)) = v.first() {
            let row = &mut self.rows[k];
            if row.is_empty() {
                *row = v;
                self.c[k] = beta;
                return;
            }
            let pivot = row[0].1;
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
            self.work += r.len() + w.len();
            std::mem::swap(row, r);
            std::mem::swap(&mut v, w);
            let a = self.c[k];
            self.c[k] = cos * a + sin * beta;
            beta = cos * beta - sin * a;
        }
    }

    /// `x` with `R x = c` by positions; `None` when a pivot is missing or the result not finite.
    pub fn solve(&self) -> Option<Vec<f64>> {
        let n = self.c.len();
        let mut x = vec![0.0; n];
        for k in (0..n).rev() {
            let row = &self.rows[k];
            let &(first, pivot) = row.first()?;
            if first != k { return None; }
            let mut sum = self.c[k];
            for &(j, value) in &row[1..] { sum -= value * x[j]; }
            x[k] = sum / pivot;
        }
        x.iter().all(|value| value.is_finite()).then_some(x)
    }
}
