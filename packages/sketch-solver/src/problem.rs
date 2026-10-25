//! The wire format, all `f64`:
//!
//! input  `[version, parameter count n, equation count m, values × n, fixed flags × n,
//!          m × [kind code, value, operand parameter indices × arity]]`
//! output `[output length, version, status, iterations, largest residual, values × n]`, with
//!        status codes from `Status`

use crate::equations::Kind;

pub const VERSION: f64 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Converged = 0,
    NotConverged = 1,
    InvalidInput = 2,
    /// A group needs more memory or work than `newton::Limits` allow.
    TooLarge = 3,
}

#[derive(Clone, Debug)]
pub struct Equation {
    pub kind: Kind,
    pub value: f64,
    pub operands: Vec<usize>,
}

#[derive(Clone, Debug)]
pub struct Problem {
    pub values: Vec<f64>,
    pub fixed: Vec<bool>,
    pub equations: Vec<Equation>,
}

fn count(value: f64) -> Option<usize> {
    (value.fract() == 0.0 && (0.0..=u32::MAX as f64).contains(&value)).then_some(value as usize)
}

pub fn decode(input: &[f64]) -> Option<Problem> {
    let (&version, rest) = input.split_first()?;
    if version != VERSION || rest.len() < 2 { return None; }
    let (n, m) = (count(rest[0])?, count(rest[1])?);
    let body = &rest[2..];
    // Counts are checked against the data before any slice or allocation; each equation takes
    // at least three values.
    if body.len() / 2 < n || (body.len() - 2 * n) / 3 < m { return None; }
    let values = body[..n].to_vec();
    if values.iter().any(|value| !value.is_finite()) { return None; }
    let fixed = body[n..2 * n].iter().map(|&flag| match flag { 0.0 => Some(false), 1.0 => Some(true), _ => None })
        .collect::<Option<Vec<_>>>()?;
    let mut cursor = &body[2 * n..];
    let mut equations = Vec::with_capacity(m);
    for _ in 0..m {
        let kind = Kind::from_code(*cursor.first()?)?;
        let value = *cursor.get(1)?;
        let operands = cursor.get(2..2 + kind.arity())?.iter().map(|&index| count(index).filter(|&index| index < n))
            .collect::<Option<Vec<_>>>()?;
        if !value.is_finite() { return None; }
        equations.push(Equation { kind, value, operands });
        cursor = &cursor[2 + kind.arity()..];
    }
    cursor.is_empty().then_some(Problem { values, fixed, equations })
}

pub fn encode_output(status: Status, iterations: usize, residual: f64, values: &[f64]) -> Vec<f64> {
    let mut output = Vec::with_capacity(5 + values.len());
    output.extend([(5 + values.len()) as f64, VERSION, status as u8 as f64, iterations as f64, residual]);
    output.extend_from_slice(values);
    output
}
