//! Forward-mode dual numbers. Each residual is written once and its exact gradient over
//! at most `WIDTH` operands comes from the same arithmetic.

use std::ops::{Add, Div, Mul, Neg, Sub};

pub const WIDTH: usize = 8;

#[derive(Clone, Copy, Debug)]
pub struct Dual {
    pub value: f64,
    pub gradient: [f64; WIDTH],
}

impl Dual {
    pub fn constant(value: f64) -> Self {
        Self { value, gradient: [0.0; WIDTH] }
    }

    /// The operand in slot `slot`, whose derivative with respect to itself is one.
    pub fn variable(value: f64, slot: usize) -> Self {
        let mut gradient = [0.0; WIDTH];
        gradient[slot] = 1.0;
        Self { value, gradient }
    }

    fn map(self, value: f64, derivative: f64) -> Self {
        Self { value, gradient: self.gradient.map(|g| g * derivative) }
    }

    pub fn sqrt(self) -> Self {
        let root = self.value.sqrt();
        // A zero length has no direction; its gradient is taken as zero rather than infinite.
        self.map(root, if root > 0.0 { 0.5 / root } else { 0.0 })
    }

    pub fn atan2(self, x: Self) -> Self {
        let squared = self.value * self.value + x.value * x.value;
        let scale = if squared > 0.0 { 1.0 / squared } else { 0.0 };
        let mut gradient = [0.0; WIDTH];
        for (slot, g) in gradient.iter_mut().enumerate() {
            *g = (x.value * self.gradient[slot] - self.value * x.gradient[slot]) * scale;
        }
        Self { value: self.value.atan2(x.value), gradient }
    }
}

fn zip(a: Dual, b: Dual, value: f64, da: f64, db: f64) -> Dual {
    let mut gradient = [0.0; WIDTH];
    for (slot, g) in gradient.iter_mut().enumerate() {
        *g = a.gradient[slot] * da + b.gradient[slot] * db;
    }
    Dual { value, gradient }
}

impl Add for Dual {
    type Output = Dual;
    fn add(self, b: Dual) -> Dual { zip(self, b, self.value + b.value, 1.0, 1.0) }
}

impl Sub for Dual {
    type Output = Dual;
    fn sub(self, b: Dual) -> Dual { zip(self, b, self.value - b.value, 1.0, -1.0) }
}

impl Mul for Dual {
    type Output = Dual;
    fn mul(self, b: Dual) -> Dual { zip(self, b, self.value * b.value, b.value, self.value) }
}

impl Div for Dual {
    type Output = Dual;
    fn div(self, b: Dual) -> Dual {
        let quotient = self.value / b.value;
        zip(self, b, quotient, 1.0 / b.value, -quotient / b.value)
    }
}

impl Neg for Dual {
    type Output = Dual;
    fn neg(self) -> Dual { self.map(-self.value, -1.0) }
}

impl Mul<f64> for Dual {
    type Output = Dual;
    fn mul(self, b: f64) -> Dual { self.map(self.value * b, b) }
}

impl Sub<f64> for Dual {
    type Output = Dual;
    fn sub(self, b: f64) -> Dual { Dual { value: self.value - b, gradient: self.gradient } }
}
