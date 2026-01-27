to_entries |
map([
    (.key | gsub("_"; "-")),
    ("oklch(" + (.value | join(" ")) + ")")
]) |
# group_by(.[0] | gsub("-.*"; "")) |
reduce .[] as $item ([]; .[if ($item[0] | test("fg|bg|border")) then 0 else 1 end] += [$item]) |
map(reduce .[] as $item ({}; .[$item[0] | gsub("-.*"; "")] += [$item])) |
map(map(map("<li style=\"background-color: var(--\(.[0]))\"\(if (.[0] | test("bg|border")) then " class=\"fg-light\"" else "" end)><div class=\"color_name\">\(.[0])</div><div class=\"color_value\">\(.[1])</div></li>") | "<ol>" + join("") + "</ol>") | "<div>" + join("") + "</div>" ) |
join("\n")
