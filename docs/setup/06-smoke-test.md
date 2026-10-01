# 6. Smoke test

Start and stop one sandbox per agent on a small repository its token can read. A plain shell names its seat; a host session sets it itself.

```bash
export FLEET_SEAT=pi
fleet build --pi     && fleet up smoke --pi --repo <small repo>     && fleet down pi-<repo>-smoke
fleet build --claude && fleet up smoke --claude --repo <small repo> && fleet down claude-<repo>-smoke
```

Person: before each `down`, open the herdr tab `up` created and send the agent one message. The first Claude sandbox asks for `/login` there (step 5).

## Check

Each agent answered in its tab, `fleet ls` lists no sandbox afterwards, and `ls ~/.sandboxes/<repo>/` still holds both task folders.
