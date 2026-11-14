//! Reading a HEIC photograph (as a phone takes them) through heic-rs: the file in, RGBA8 out, its
//! width and height in `q_info(0)` and `q_info(1)`.
glue::exports!();
use heic_rs::{decode, DecodeOptions, PixelLayout};

/// Decodes a HEIC file the page wrote with `q_alloc`; gives the pixels' length, or a negative number.
#[unsafe(export_name = "decode")]
pub unsafe extern "C" fn decode_heic(p: *const u8, n: usize) -> i32 {
    let options = DecodeOptions { layout: PixelLayout::Rgba8, ..DecodeOptions::default() };
    match decode(unsafe { glue::input(p, n) }, &options) {
        Ok(image) => {
            glue::set_info([image.width, image.height, 4, 0]);
            glue::set_out(image.data)
        }
        Err(_) => -1,
    }
}
