include ".zs/components/get_filename";

map("\(.image) \(. | filename)") | join("\n")
