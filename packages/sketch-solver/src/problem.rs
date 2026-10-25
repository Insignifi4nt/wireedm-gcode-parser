//! The wire format, all `f64`:
//!
//! input  `[version, parameter count n, equation count m, values × n, fixed flags × n,
//!          m × [kind code, value, tag, flags, operand parameter indices × arity]]`
//! output `[output length, version, status, iterations, largest residual, diagnosis,
//!          degrees of freedom, values × n, labels × m]`, with status codes from `Status`,
//!        diagnosis codes from `Diagnosis` and label bits from `diagnose`
//!
//! A tag names the source constraint an equation belongs to; tags never decrease, and the
//! equations of one constraint share it. Flag 1 marks a temporary equation, such as a drag
//! target, that is solved but left out of diagnosis. Degrees of freedom are NaN unless the
//! sketch was diagnosed without conflicts.

use crate::equations::Kind;

pub const VERSION: f64 = 2.0;
pub const TEMPORARY: f64 = 1.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Converged = 0,
    NotConverged = 1,
    InvalidInput = 2,
    /// A group needs more memory or work than `newton::Limits` allow.
    TooLarge = 3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Diagnosis {
    Diagnosed = 0,
    /// Some group's rank could not be decided reliably, or it was too large.
    Unavailable = 1,
    /// Nothing can move, so there is no freedom to diagnose against.
    NoUnknowns = 2,
}

#[derive(Clone, Debug)]
pub struct Equation {
    pub kind: Kind,
    pub value: f64,
    pub tag: usize,
    pub temporary: bool,
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
    // at least five values.
    if body.len() / 2 < n || (body.len() - 2 * n) / 5 < m { return None; }
    let values = body[..n].to_vec();
    if values.iter().any(|value| !value.is_finite()) { return None; }
    let fixed = body[n..2 * n].iter().map(|&flag| match flag { 0.0 => Some(false), 1.0 => Some(true), _ => None })
        .collect::<Option<Vec<_>>>()?;
    let mut cursor = &body[2 * n..];
    let mut equations: Vec<Equation> = Vec::with_capacity(m);
    for _ in 0..m {
        let kind = Kind::from_code(*cursor.first()?)?;
        let (value, tag) = (*cursor.get(1)?, count(*cursor.get(2)?)?);
        let temporary = match *cursor.get(3)? { 0.0 => false, TEMPORARY => true, _ => return None };
        let operands = cursor.get(4..4 + kind.arity())?.iter().map(|&index| count(index).filter(|&index| index < n))
            .collect::<Option<Vec<_>>>()?;
        if !value.is_finite() || equations.last().is_some_and(|last| last.tag > tag) { return None; }
        equations.push(Equation { kind, value, tag, temporary, operands });
        cursor = &cursor[4 + kind.arity()..];
    }
    cursor.is_empty().then_some(Problem { values, fixed, equations })
}

pub struct Output<'a> {
    pub status: Status,
    pub iterations: usize,
    pub residual: f64,
    pub diagnosis: Diagnosis,
    pub degrees_of_freedom: Option<usize>,
    pub values: &'a [f64],
    pub labels: &'a [u8],
}

pub fn encode_output(output: &Output) -> Vec<f64> {
    let length = 7 + output.values.len() + output.labels.len();
    let mut buffer = Vec::with_capacity(length);
    buffer.extend([length as f64, VERSION, output.status as u8 as f64, output.iterations as f64, output.residual,
        output.diagnosis as u8 as f64, output.degrees_of_freedom.map_or(f64::NAN, |dof| dof as f64)]);
    buffer.extend_from_slice(output.values);
    buffer.extend(output.labels.iter().map(|&label| label as f64));
    buffer
}
