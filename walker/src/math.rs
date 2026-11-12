//! Vectors, rotations and the few functions of a real number the engine needs. They are written here
//! from adding, multiplying and dividing alone, which every browser and processor rounds the same way,
//! so a run gives the same numbers in any browser and in the native tests, and a shared walker walks
//! the same for everyone. (Stable Rust offers no square root without the standard library, which is
//! another reason to write one.)

use core::ops::{Add, AddAssign, Mul, Neg, Sub, SubAssign};

pub const PI: f32 = core::f32::consts::PI;

/// The square root, by Newton's method in double precision from a guess that halves the exponent.
/// Five rounds take the guess from a few percent out to the last bit of a double.
pub fn sqrt64(x: f64) -> f64 {
    if x <= 0.0 || x.is_nan() || x == f64::INFINITY {
        return if x > 0.0 { x } else { 0.0 };
    }
    let mut guess = f64::from_bits((x.to_bits() >> 1) + (1023u64 << 51));
    for _ in 0..5 {
        guess = 0.5 * (guess + x / guess);
    }
    guess
}

/// The square root of an f32, worked in double precision and rounded once.
#[inline]
pub fn sqrt(x: f32) -> f32 {
    sqrt64(x as f64) as f32
}

/// Rounds to the nearest whole number, as an integer.
#[inline]
fn nearest(x: f64) -> i64 {
    if x >= 0.0 { (x + 0.5) as i64 } else { (x - 0.5) as i64 }
}

/// The sine and cosine of an angle together. The angle is brought within a quarter turn of zero and
/// two short polynomials do the rest; they are the ones the C library musl uses, good to the last bit
/// of an f32.
#[allow(clippy::excessive_precision)]
pub fn sin_cos(angle: f32) -> (f32, f32) {
    let x = angle as f64;
    let quarter = nearest(x * (2.0 / core::f64::consts::PI));
    let r = x - quarter as f64 * core::f64::consts::FRAC_PI_2;
    let z = r * r;
    let w = z * z;
    let sine = (r + z * r * (-0.166666666416265235595 + z * 0.0083333293858894631756)) + z * r * w * (-0.000198393348360966317347 + z * 0.0000027183114939898219064);
    let cosine = ((1.0 + z * -0.499999997251031003120) + w * 0.0416666233237390631894) + (w * z) * (-0.00138867637746099294692 + z * 0.0000243904487962774090654);
    let (s, c) = match quarter & 3 {
        0 => (sine, cosine),
        1 => (cosine, -sine),
        2 => (-sine, -cosine),
        _ => (-cosine, sine),
    };
    (s as f32, c as f32)
}

/// The arctangent of x, for any x.
fn atan64(x: f64) -> f64 {
    let negative = x < 0.0;
    let mut x = if negative { -x } else { x };
    let mut offset = 0.0;
    if x > 1.0 {
        x = 1.0 / x;
        offset = core::f64::consts::FRAC_PI_2;
    }
    // halving the angle once brings x under tan(pi/8), where the series below is short
    let half = x / (1.0 + sqrt64(1.0 + x * x));
    let z = half * half;
    let mut sum = 0.0;
    let mut term = 1.0 / 17.0;
    let mut odd: f64 = 17.0;
    while odd > 0.0 {
        sum = term - z * sum;
        odd -= 2.0;
        term = 1.0 / odd.max(1.0);
    }
    let mut angle = 2.0 * half * sum;
    if offset != 0.0 {
        angle = offset - angle;
    }
    if negative { -angle } else { angle }
}

/// The angle of the point (x, y) from the positive x axis, from minus pi to pi.
pub fn atan2(y: f32, x: f32) -> f32 {
    let (y, x) = (y as f64, x as f64);
    if x == 0.0 {
        return if y > 0.0 {
            PI / 2.0
        } else if y < 0.0 {
            -PI / 2.0
        } else {
            0.0
        };
    }
    let angle = atan64(y / x);
    let angle = if x > 0.0 {
        angle
    } else if y >= 0.0 {
        angle + core::f64::consts::PI
    } else {
        angle - core::f64::consts::PI
    };
    angle as f32
}

/// e to the power x, for x between about -700 and 700.
fn exp64(x: f64) -> f64 {
    let whole = nearest(x * core::f64::consts::LOG2_E);
    let r = x - whole as f64 * core::f64::consts::LN_2;
    // |r| is under ln(2)/2, where twelve terms of the series are exact to a double
    let mut sum = 1.0;
    let mut n = 12.0;
    while n > 0.0 {
        sum = 1.0 + r * sum / n;
        n -= 1.0;
    }
    sum * f64::from_bits(((whole + 1023) as u64) << 52)
}

/// The natural logarithm of a positive x, by splitting off its power of two and summing the series
/// for the rest. Nothing calls it often; it turns a starting stride into a brain's biases.
pub fn ln(x: f32) -> f32 {
    if x <= 0.0 {
        return f32::NEG_INFINITY;
    }
    let x = x as f64;
    let bits = x.to_bits();
    let power = ((bits >> 52) & 0x7ff) as i64 - 1023;
    let rest = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | (1023u64 << 52));
    // ln(rest) = 2 atanh(t) with t = (rest - 1) / (rest + 1), under a third, where twenty terms suffice
    let t = (rest - 1.0) / (rest + 1.0);
    let mut sum = 0.0;
    let mut odd: f64 = 41.0;
    while odd > 0.0 {
        sum = 1.0 / odd + t * t * sum;
        odd -= 2.0;
    }
    (2.0 * t * sum + power as f64 * core::f64::consts::LN_2) as f32
}

/// The hyperbolic tangent, which the brain's neurons use to squash what they add up into -1 to 1.
pub fn tanh(x: f32) -> f32 {
    if x > 9.0 {
        return 1.0;
    }
    if x < -9.0 {
        return -1.0;
    }
    let e = exp64(2.0 * x as f64);
    ((e - 1.0) / (e + 1.0)) as f32
}

/// Keeps an angle between minus pi and pi.
pub fn wrap(angle: f32) -> f32 {
    let turns = nearest(angle as f64 / (2.0 * core::f64::consts::PI));
    (angle as f64 - turns as f64 * 2.0 * core::f64::consts::PI) as f32
}

#[inline]
pub fn clamp(x: f32, low: f32, high: f32) -> f32 {
    if x < low {
        low
    } else if x > high {
        high
    } else {
        x
    }
}

/// A point or a direction in the plane, in metres, with y up.
#[derive(Clone, Copy, Default, PartialEq, Debug)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };

    #[inline]
    pub const fn new(x: f32, y: f32) -> Vec2 {
        Vec2 { x, y }
    }

    #[inline]
    pub fn dot(self, other: Vec2) -> f32 {
        self.x * other.x + self.y * other.y
    }

    /// The z part of the cross product, how far other turns from self.
    #[inline]
    pub fn cross(self, other: Vec2) -> f32 {
        self.x * other.y - self.y * other.x
    }

    /// The velocity of a point at this offset on something spinning at `spin` radians a second.
    #[inline]
    pub fn spun(self, spin: f32) -> Vec2 {
        Vec2::new(-spin * self.y, spin * self.x)
    }

    /// Turned a quarter turn to the left.
    #[inline]
    pub fn left(self) -> Vec2 {
        Vec2::new(-self.y, self.x)
    }

    /// Turned a quarter turn to the right.
    #[inline]
    pub fn right(self) -> Vec2 {
        Vec2::new(self.y, -self.x)
    }

    #[inline]
    pub fn length_squared(self) -> f32 {
        self.dot(self)
    }

    #[inline]
    pub fn length(self) -> f32 {
        sqrt(self.dot(self))
    }

    /// The same direction with length one, or zero for a vector too short to have a direction.
    pub fn normalized(self) -> Vec2 {
        let length = self.length();
        if length < 1e-9 { Vec2::ZERO } else { self * (1.0 / length) }
    }

    #[inline]
    pub fn lerp(self, other: Vec2, t: f32) -> Vec2 {
        self + (other - self) * t
    }
}

impl Add for Vec2 {
    type Output = Vec2;
    #[inline]
    fn add(self, other: Vec2) -> Vec2 {
        Vec2::new(self.x + other.x, self.y + other.y)
    }
}

impl Sub for Vec2 {
    type Output = Vec2;
    #[inline]
    fn sub(self, other: Vec2) -> Vec2 {
        Vec2::new(self.x - other.x, self.y - other.y)
    }
}

impl Mul<f32> for Vec2 {
    type Output = Vec2;
    #[inline]
    fn mul(self, scale: f32) -> Vec2 {
        Vec2::new(self.x * scale, self.y * scale)
    }
}

impl Neg for Vec2 {
    type Output = Vec2;
    #[inline]
    fn neg(self) -> Vec2 {
        Vec2::new(-self.x, -self.y)
    }
}

impl AddAssign for Vec2 {
    #[inline]
    fn add_assign(&mut self, other: Vec2) {
        *self = *self + other;
    }
}

impl SubAssign for Vec2 {
    #[inline]
    fn sub_assign(&mut self, other: Vec2) {
        *self = *self - other;
    }
}

/// A rotation, kept as its cosine and sine so that turning a point needs no sine at all.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Rotation {
    pub cos: f32,
    pub sin: f32,
}

impl Default for Rotation {
    fn default() -> Self {
        Rotation::NONE
    }
}

impl Rotation {
    pub const NONE: Rotation = Rotation { cos: 1.0, sin: 0.0 };

    pub fn from_angle(angle: f32) -> Rotation {
        let (sin, cos) = sin_cos(angle);
        Rotation { cos, sin }
    }

    pub fn angle(self) -> f32 {
        atan2(self.sin, self.cos)
    }

    #[inline]
    pub fn apply(self, v: Vec2) -> Vec2 {
        Vec2::new(self.cos * v.x - self.sin * v.y, self.sin * v.x + self.cos * v.y)
    }

    /// Turns a point back the other way.
    #[inline]
    pub fn undo(self, v: Vec2) -> Vec2 {
        Vec2::new(self.cos * v.x + self.sin * v.y, -self.sin * v.x + self.cos * v.y)
    }

    /// This rotation turned further by a small angle, kept at length one.
    #[inline]
    pub fn turned(self, angle: f32) -> Rotation {
        let cos = self.cos - angle * self.sin;
        let sin = self.sin + angle * self.cos;
        let scale = 1.0 / sqrt(cos * cos + sin * sin);
        Rotation { cos: cos * scale, sin: sin * scale }
    }

    /// The rotation that takes this one to `other`.
    #[inline]
    pub fn between(self, other: Rotation) -> Rotation {
        Rotation { cos: self.cos * other.cos + self.sin * other.sin, sin: self.cos * other.sin - self.sin * other.cos }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_cosine_and_arctangent_agree_with_the_standard_library() {
        let mut angle = -20.0f32;
        while angle < 20.0 {
            let (s, c) = sin_cos(angle);
            assert!((s - angle.sin()).abs() < 2e-7, "sin {angle}");
            assert!((c - angle.cos()).abs() < 2e-7, "cos {angle}");
            assert!((atan2(s, c) - wrap(angle)).abs() < 2e-6, "atan2 {angle}");
            assert!((tanh(angle * 0.3) - (angle * 0.3).tanh()).abs() < 2e-7, "tanh {angle}");
            let positive = angle.abs() * 3.0 + 0.01;
            assert!((ln(positive) - positive.ln()).abs() < 2e-6, "ln {positive}");
            angle += 0.0137;
        }
        assert!((atan2(1.0, -1.0) - 3.0 * PI / 4.0).abs() < 1e-6);
        assert!((atan2(-1.0, -1.0) + 3.0 * PI / 4.0).abs() < 1e-6);
    }
}
