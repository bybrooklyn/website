include ".zs/components/get_filename";

map("<a href=\"\(.link)\"><img src=\"\($BUTTONS_DIR + (. | filename))\" alt=\"An 88x31 button. \(.alt)\" title=\"\(.title)\"></a>") | join("\n")
