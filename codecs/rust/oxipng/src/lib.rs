//! PNG through oxipng: RGBA8 in, the smallest PNG its preset finds out. `level` is oxipng's preset
//! from 0 to 6; the quality is not used, PNG being lossless.
glue::exports!();
use oxipng::{BitDepth, ColorType, Options, RawImage};

/// Encodes RGBA8 pixels the page wrote with `q_alloc`; gives the file's length, or a negative number.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn encode(p: *const u8, n: usize, w: u32, h: u32, _q: f32, level: u32) -> i32 {
    let pixels = unsafe { glue::input(p, n) }.to_vec();
    let Ok(image) = RawImage::new(w, h, ColorType::RGBA, BitDepth::Eight, pixels) else { return -2 };
    match image.create_optimized_png(&Options::from_preset(level.min(6) as u8)) {
        Ok(file) => glue::set_out(file),
        Err(_) => -1,
    }
}

/// Options are not used by this encoder; the call is here so that every module answers the same calls.
#[unsafe(no_mangle)]
pub extern "C" fn q_opt(_key: i32, _value: i32) {}
