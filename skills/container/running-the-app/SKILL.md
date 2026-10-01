---
name: running-the-app
description: 'Start and stop the app in this container through the shared runbook, and keep the runbook true for the next container. Use whenever the app or a service it needs has to run: an e2e suite, a repro, a walk of its screens, a manual check.'
---

# Running the app

The runbook is shared by every container on this repository set. A start that lives only in this task's notes dies with this container, and the next one works it out again.

## Start

1. With `run.sh` in the runbook: `run.sh start` brings the app up and prints the URL. `run.md` says what the script does, where credentials come from, and one line per workaround with its reason. Done when the URL answers.
2. With no `run.sh`: start with the repository's own script. The first start that answers writes `run.sh` (`start` prints the URL, `stop` frees the ports) and `run.md`, before the work that needed the app goes on.

## Keep the runbook true

A fact about starting the app that the runbook lacks or contradicts goes into `run.sh` or `run.md` the moment it is confirmed, in whichever step of the run you are: a service `run.sh start` leaves down, an env variable, a port, a stub, a step run by hand. A start that fails from the runbook is such a fact once the fix answers. A workaround the start no longer needs comes out. Written in English. Your report names every runbook file touched.

## Stop

`run.sh stop`, then a request per port confirms nothing answers; the stop script's own report is not that confirmation. The lines the start added to `/etc/sandbox-persistent.sh` come out.
