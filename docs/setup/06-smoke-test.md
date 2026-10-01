# 6. Smoke test

Start and stop one sandbox per installed agent on the small repository the person named in step 2. `<path>` is its clone, and `<repo>` its folder name. This shell names its seat with `FLEET_SEAT`, set to an installed agent; a host session sets it by itself. Run the lines of the agents the person installed:

```bash
export FLEET_SEAT=pi                                          # or claude
fleet build --pi     && fleet up smoke --pi --repo <path>      # with pi
fleet build --claude && fleet up smoke --claude --repo <path>  # with Claude Code
```

Person: open each herdr tab `up` created and send the agent "hello". The first Claude sandbox asks for `/login` there (step 5). Then, for each sandbox started:

```bash
fleet down pi-<repo>-smoke
fleet down claude-<repo>-smoke
```

## Check

Each agent answered in its tab, `fleet ls` lists no sandbox afterwards, and `ls ~/.fleet/tasks/<repo>/` holds one task folder per installed agent, `pi-<repo>-smoke` and `claude-<repo>-smoke`. If `fleet up` stops on the GitHub token, step 4 is unfinished for that repository.
