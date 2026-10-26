#![allow(dead_code)]

use sketch_solver::equations::Kind;
use sketch_solver::newton::{Limits, Outcome, solve_within};
use sketch_solver::problem::{Status, VERSION, decode};
use sketch_solver::solve_buffer;

/// A problem in wire form. Each equation is its own constraint unless added with `same`.
pub struct Builder { pub values: Vec<f64>, pub fixed: Vec<bool>, equations: Vec<(Kind, f64, usize, bool, Vec<usize>)> }

impl Builder {
    pub fn new() -> Self { Self { values: Vec::new(), fixed: Vec::new(), equations: Vec::new() } }
    pub fn point(&mut self, x: f64, y: f64, fixed: bool) -> [usize; 2] {
        self.values.extend([x, y]);
        self.fixed.extend([fixed, fixed]);
        [self.values.len() - 2, self.values.len() - 1]
    }
    pub fn parameter(&mut self, value: f64, fixed: bool) -> usize {
        self.values.push(value);
        self.fixed.push(fixed);
        self.values.len() - 1
    }
    pub fn equation(&mut self, kind: Kind, value: f64, operands: &[usize]) {
        let tag = self.equations.last().map_or(0, |e| e.2 + 1);
        self.equations.push((kind, value, tag, false, operands.to_vec()));
    }
    /// Another equation of the previous constraint.
    pub fn same(&mut self, kind: Kind, value: f64, operands: &[usize]) {
        let tag = self.equations.last().expect("a previous constraint").2;
        self.equations.push((kind, value, tag, false, operands.to_vec()));
    }
    pub fn temporary(&mut self, kind: Kind, value: f64, operands: &[usize]) {
        self.equation(kind, value, operands);
        self.equations.last_mut().unwrap().3 = true;
    }
    pub fn encode(&self) -> Vec<f64> {
        let mut buffer = vec![VERSION, self.values.len() as f64, self.equations.len() as f64];
        buffer.extend(&self.values);
        buffer.extend(self.fixed.iter().map(|&fixed| if fixed { 1.0 } else { 0.0 }));
        for (kind, value, tag, temporary, operands) in &self.equations {
            buffer.push(Kind::ALL.iter().position(|k| k == kind).unwrap() as f64);
            buffer.extend([*value, *tag as f64, if *temporary { 1.0 } else { 0.0 }]);
            buffer.extend(operands.iter().map(|&o| o as f64));
        }
        buffer
    }
    /// `(status, iterations, values)` through the wire.
    pub fn solve(&self) -> (f64, f64, Vec<f64>) {
        let output = solve_buffer(&self.encode());
        assert_eq!(output[0] as usize, output.len());
        assert_eq!(output[1], VERSION);
        let n = self.values.len();
        assert_eq!(output.len(), 7 + n + self.equations.len());
        (output[2], output[3], output[7..7 + n].to_vec())
    }
    /// The whole outcome and the solved values.
    pub fn outcome(&self) -> (Outcome, Vec<f64>) { self.outcome_within(sketch_solver::newton::LIMITS) }
    pub fn outcome_within(&self, limits: Limits) -> (Outcome, Vec<f64>) {
        let problem = decode(&self.encode()).unwrap();
        let mut values = problem.values.clone();
        let outcome = solve_within(&problem, &mut values, limits);
        (outcome, values)
    }
    /// `(status, iterations, values)` within `limits`.
    pub fn solve_within(&self, limits: Limits) -> (Status, usize, Vec<f64>) {
        let (outcome, values) = self.outcome_within(limits);
        (outcome.status, outcome.iterations, values)
    }
}
