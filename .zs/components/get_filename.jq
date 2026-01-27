def filename: .file + (.image | match("\\.[0-9a-z]+$") | .string);
