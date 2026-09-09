mod web 'apps/web'
mod infra 'infra'

dev:
    pnpm -C apps/web run dev

build:
    pnpm -C apps/web run build

deploy:
    pnpm -C apps/web run build
    pnpm -C infra run deploy

check:
    pnpm -C apps/web run check

test:
    pnpm -C apps/web run test

drift *ARGS:
    pnpm -C apps/web run drift -- {{ARGS}}
