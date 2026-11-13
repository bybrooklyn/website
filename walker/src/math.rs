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

/// The processor's own square root of a double, which IEEE 754 requires to be exact to the last bit
/// on every machine and in every browser. Stable Rust reaches WebAssembly's square root only through
/// its SIMD form, so the build without SIMD uses Newton's instead; everything that calls this gives
/// the same f32 either way (see `sqrt`, `atan2` and their tests), only slower.
#[inline]
fn hardware_sqrt(x: f64) -> f64 {
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::{f64x2_extract_lane, f64x2_splat, f64x2_sqrt};
        f64x2_extract_lane::<0>(f64x2_sqrt(f64x2_splat(x)))
    }
    #[cfg(all(target_arch = "wasm32", not(target_feature = "simd128")))]
    {
        sqrt64(x)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        x.sqrt()
    }
}

/// The square root of an f32, worked in double precision and rounded once. For every positive f32
/// this is the same, to the bit, as `sqrt64` rounded to an f32 (a test checks all two billion of
/// them), so the processor's square root is used, which is many times quicker.
#[inline]
pub fn sqrt(x: f32) -> f32 {
    // not above zero, or not a number: zero, as sqrt64 gives
    if x.is_nan() || x <= 0.0 {
        return 0.0;
    }
    hardware_sqrt(x as f64) as f32
}

/// Whether a double rounds to the same f32 wherever it is within `close` of where it is: then a
/// quick answer known to be that close to the exact way's answer rounds to the same f32 as the exact
/// way would, and the exact way need not be worked at all. (This is Ziv's rounding test.)
#[inline]
fn settled(value: f64, close: f64) -> Option<f32> {
    let (low, high) = ((value - close) as f32, (value + close) as f32);
    (low.to_bits() == high.to_bits() && !value.is_nan()).then_some(low)
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

/// The arctangent of x, for any x, the way it was always worked: the angle halved once, which
/// brings it under tan(pi/8), and then nine terms of x - x^3/3 + x^5/5 ..., summed from the smallest.
fn atan64(x: f64) -> f64 {
    let negative = x < 0.0;
    let mut x = if negative { -x } else { x };
    let mut offset = 0.0;
    if x > 1.0 {
        x = 1.0 / x;
        offset = core::f64::consts::FRAC_PI_2;
    }
    let half = x / (1.0 + sqrt64(1.0 + x * x));
    let z = half * half;
    let mut sum = 0.0;
    for term in [1.0 / 17.0, 1.0 / 15.0, 1.0 / 13.0, 1.0 / 11.0, 1.0 / 9.0, 1.0 / 7.0, 1.0 / 5.0, 1.0 / 3.0, 1.0] {
        sum = term - z * sum;
    }
    let mut angle = 2.0 * half * sum;
    if offset != 0.0 {
        angle = offset - angle;
    }
    if negative { -angle } else { angle }
}

/// The angle of the point (x, y) from the positive x axis, from minus pi to pi.
///
/// Worked the quick way first: the same halved angle and the same nine terms, but the half found
/// with one division and the processor's square root, and the terms added in pairs and fours so the
/// processor can work several at once. That lands within a few parts in 2^53 of the exact way's
/// answer, far less than the share of itself allowed here; unless that much could round to a
/// different f32, it is the f32 the exact way gives, and the exact way is not worked at all.
#[inline]
pub fn atan2(y: f32, x: f32) -> f32 {
    let quick = atan2_quick(y as f64, x as f64);
    match settled(quick, quick.abs() * 2e-14) {
        Some(angle) => angle,
        None => atan2_exact(y, x),
    }
}

#[inline]
fn atan2_quick(y: f64, x: f64) -> f64 {
    // on an axis the exact way keeps the sign of a zero, which is quicker to leave to it
    if x == 0.0 || y == 0.0 {
        return atan2_exact(y as f32, x as f32) as f64;
    }
    let (across, up) = (x.abs(), y.abs());
    let root = hardware_sqrt(x * x + y * y);
    // y / x over one is the exact way's turn to work with x / y and a quarter turn less; for f32
    // given, y / x rounds to over one exactly when |y| is over |x|
    let (half, offset) = if up > across { (across / (up + root), core::f64::consts::FRAC_PI_2) } else { (up / (across + root), 0.0) };
    let w = -(half * half);
    let (w2, w4) = (w * w, (w * w) * (w * w));
    const C: [f64; 9] = [1.0, 1.0 / 3.0, 1.0 / 5.0, 1.0 / 7.0, 1.0 / 9.0, 1.0 / 11.0, 1.0 / 13.0, 1.0 / 15.0, 1.0 / 17.0];
    let sum = (C[0] + C[1] * w) + (C[2] + C[3] * w) * w2 + ((C[4] + C[5] * w) + (C[6] + C[7] * w) * w2) * w4 + C[8] * (w4 * w4);
    let mut angle = 2.0 * half * sum;
    if offset != 0.0 {
        angle = offset - angle;
    }
    // the exact way's y / x is below zero when the two differ in sign and y is not zero
    let negative = (y < 0.0) != (x < 0.0) && y != 0.0;
    let angle = if negative { -angle } else { angle };
    if x > 0.0 {
        angle
    } else if y >= 0.0 {
        angle + core::f64::consts::PI
    } else {
        angle - core::f64::consts::PI
    }
}

/// The angle the way it was always worked.
fn atan2_exact(y: f32, x: f32) -> f32 {
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

/// e to the power x, worked in double precision and rounded once, so it is the same on every
/// machine. Gradient learning uses it for a policy's spread and the ratio of two chances.
pub fn exp(x: f32) -> f32 {
    exp64(clamp(x, -80.0, 80.0) as f64) as f32
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

/// e to the power r for r within ln(2)/2 of zero: the same twelve terms of the series `exp64` sums,
/// but each divided by its factorial as a constant, and added in pairs and fours (Estrin's way) so
/// the processor can work several at once. It is within a few parts in 2^53 of what `exp64` gives.
#[inline]
fn exp_near_zero(r: f64) -> f64 {
    const C: [f64; 13] = [1.0, 1.0, 1.0 / 2.0, 1.0 / 6.0, 1.0 / 24.0, 1.0 / 120.0, 1.0 / 720.0, 1.0 / 5040.0, 1.0 / 40320.0, 1.0 / 362880.0, 1.0 / 3628800.0, 1.0 / 39916800.0, 1.0 / 479001600.0];
    let r2 = r * r;
    let r4 = r2 * r2;
    let r8 = r4 * r4;
    let low = (C[0] + C[1] * r) + (C[2] + C[3] * r) * r2;
    let middle = (C[4] + C[5] * r) + (C[6] + C[7] * r) * r2;
    let high = (C[8] + C[9] * r) + (C[10] + C[11] * r) * r2 + C[12] * r4;
    low + middle * r4 + high * r8
}

/// The hyperbolic tangent, which the brain's neurons use to squash what they add up into -1 to 1.
/// The quick way first: unless its answer is so near the middle of two f32 that the slower exact
/// way might round the other way, it is the f32 the exact way gives. A test checks every f32.
#[inline]
pub fn tanh(x: f32) -> f32 {
    if x > 9.0 {
        return 1.0;
    }
    if x < -9.0 {
        return -1.0;
    }
    let twice = 2.0 * x as f64;
    let whole = nearest(twice * core::f64::consts::LOG2_E);
    let r = twice - whole as f64 * core::f64::consts::LN_2;
    let e = exp_near_zero(r) * f64::from_bits(((whole + 1023) as u64) << 52);
    // the quick e is within a few parts in 2^53 of the exact one, which moves (e - 1) / (e + 1) by
    // under 2^-49; 2^-46 leaves room to spare
    match settled((e - 1.0) / (e + 1.0), 1.0 / (1u64 << 46) as f64) {
        Some(value) => value,
        None => tanh_exact(x),
    }
}

/// The hyperbolic tangent the way it was always worked, by `exp64`.
fn tanh_exact(x: f32) -> f32 {
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
#[inline]
pub fn wrap(angle: f32) -> f32 {
    // within three of zero there is no whole turn to take off, and the answer is the angle itself,
    // to the bit, as the long way gives it
    if angle > -3.0 && angle < 3.0 {
        return angle;
    }
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

    /// Runs a check over every f32 bit pattern from `low` to `high`, on every core, and returns the
    /// ones it failed for (at most a few).
    fn every_f32(low: u32, high: u32, same: impl Fn(f32) -> bool + Sync) -> Vec<u32> {
        let cores = std::thread::available_parallelism().map_or(8, |n| n.get()) as u32;
        let share = (high - low) / cores + 1;
        std::thread::scope(|scope| {
            let workers: Vec<_> = (0..cores)
                .map(|core| {
                    let same = &same;
                    scope.spawn(move || {
                        let start = low.saturating_add(core * share);
                        let end = start.saturating_add(share).min(high);
                        (start..end).filter(|&bits| !same(f32::from_bits(bits))).take(8).collect::<Vec<u32>>()
                    })
                })
                .collect();
            workers.into_iter().flat_map(|worker| worker.join().unwrap()).collect()
        })
    }

    // These take a minute or so each, on every core: `cargo test --release -- --ignored every`.

    #[test]
    #[ignore]
    fn every_positive_f32_has_the_same_square_root_from_newton_and_from_the_processor() {
        let wrong = every_f32(1, 0x7f80_0000, |x| (sqrt64(x as f64) as f32).to_bits() == ((x as f64).sqrt() as f32).to_bits());
        assert!(wrong.is_empty(), "differs for {wrong:x?}");
    }

    #[test]
    #[ignore]
    fn every_f32_has_the_same_tanh_the_quick_way_as_the_exact_way() {
        let wrong = every_f32(0, u32::MAX, |x| x.is_nan() || tanh(x).to_bits() == tanh_exact(x).to_bits());
        assert!(wrong.is_empty(), "differs for {wrong:x?}");
    }

    /// The square root is the only part of the quick angle that differs from the exact one, and it
    /// differs only for a double, which cannot all be tried, so this tries many angles of each size.
    #[test]
    #[ignore]
    fn every_size_of_angle_comes_out_the_same_the_quick_way_as_the_exact_way() {
        let wrong = every_f32(0, 0x7f80_0000, |y| {
            [1.0f32, -1.0, 0.37, -2.9, 1e-3, 7e5].iter().all(|&x| atan2(y, x).to_bits() == atan2_exact(y, x).to_bits() && atan2(-y, x).to_bits() == atan2_exact(-y, x).to_bits())
        });
        assert!(wrong.is_empty(), "differs for {wrong:x?}");
    }

    #[test]
    #[ignore]
    fn every_f32_is_wrapped_the_same_with_the_short_cut_as_the_long_way() {
        let long = |angle: f32| {
            let turns = nearest(angle as f64 / (2.0 * core::f64::consts::PI));
            (angle as f64 - turns as f64 * 2.0 * core::f64::consts::PI) as f32
        };
        let wrong = every_f32(0, u32::MAX, |x| x.is_nan() || wrap(x).to_bits() == long(x).to_bits());
        assert!(wrong.is_empty(), "differs for {wrong:x?}");
    }

    #[test]
    fn the_quick_tanh_and_angle_agree_with_the_exact_ones_here_and_there() {
        let mut x = -12.0f32;
        while x < 12.0 {
            assert_eq!(tanh(x).to_bits(), tanh_exact(x).to_bits(), "tanh {x}");
            for y in [0.0f32, -0.0, 1.0, -1.0, 3.5, 1e-7] {
                assert_eq!(atan2(y, x).to_bits(), atan2_exact(y, x).to_bits(), "atan2 {y} {x}");
                assert_eq!(atan2(x, y).to_bits(), atan2_exact(x, y).to_bits(), "atan2 {x} {y}");
            }
            x += 0.00173;
        }
    }
}
