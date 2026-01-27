-- This is taken from http://lua-users.org/wiki/SortedIteration
-- This version is stripped of comments and empty lines + some stuff is renamed

local function cmp(op1, op2)
    local type1, type2 = type(op1), type(op2)
    if type1 ~= type2 then --cmp by type
        return type1 < type2
    elseif type1 == "number" or type1 == "string" then --type2 is equal to type1
        return op1 < op2 --comp by default
    elseif type1 == "boolean" then
        return op1 == true
    else
        return tostring(op1) < tostring(op2) --cmp by address
    end
end

local function __gen_oindex(t)
    local oindex = {}
    for key in pairs(t) do
        table.insert(oindex, key)
    end
    table.sort(oindex, cmp)
    return oindex
end

local function onext(t, state)
    local key = nil
    if state == nil then
        t.__oindex = __gen_oindex(t)
        key = t.__oindex[1]
    else
        for i = 1, #t.__oindex do
            if t.__oindex[i] == state then
                key = t.__oindex[i + 1]
            end
        end
    end
    if key then
        return key, t[key]
    end
    t.__oindex = nil
end

local function opairs(t)
    return onext, t, nil
end

local html = {}

---@alias Node { tag: string?, [string|number]: any }

local entities = {
    { "&", "&amp;" },
    { "<", "&lt;" },
    { ">", "&gt;" },
    { [["]], "&quot;" },
    { "'", "&#x27;" },
}

local void_tags = {
    area = true,
    base = true,
    br = true,
    col = true,
    embed = true,
    hr = true,
    img = true,
    input = true,
    link = true,
    meta = true,
    source = true,
    track = true,
    wbr = true,
}

local function key_length(t)
    local n = 0
    for k in pairs(t) do
        if type(k) == "string" then
            n = n + 1
        end
    end
    return n
end

---@param content string
function html.sanitize(content)
    for _, pair in ipairs(entities) do
        content = content:gsub(pair[1], pair[2])
    end

    return content
end

---@param node Node
function html.render(node)
    local state = {}

    local function push(value)
        table.insert(state, tostring(value))
    end

    if node.tag then
        push "<"
        push(node.tag)

        for attr, value in opairs(node) do
            if type(attr) == "string" and attr ~= "tag" then
                push " "
                push(attr)
                if value ~= "" then
                    push [[="]]
                    push(html.sanitize(type(value) == "string" and value or tostring(value)))
                    push [["]]
                end
            end
        end

        push ">"
    elseif key_length(node) > 0 then
        error("cannot set attributes on a list of values", 2)
    end

    if void_tags[node.tag] and #node > 0 then
        error("'" .. node.tag .. "' is a void tag and cannot have children", 2)
    end

    for _, value in ipairs(node) do
        local type = type(value)
        if type == "string" then
            push(html.sanitize(value))
        elseif type == "table" then
            push(html.render(value))
        else
            push(html.sanitize(tostring(value)))
        end
    end

    if not void_tags[node.tag] and node.tag then
        push "</"
        push(node.tag)
        push ">"
    end

    return table.concat(state, "")
end

return setmetatable(html, {
    __call = function(_, ...)
        return html.render(...)
    end,
})
