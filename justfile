set shell := ["sh", "-eu", "-c"]

serve:
    zola serve --interface 127.0.0.1 --port 1111

build:
    zola build

zola-check:
    zola check

check:
    zola check

clean:
    rm -rf public
