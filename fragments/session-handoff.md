| Step | What happens |
| --- | --- |
| suggest | the container sets `attention:` to `session handoff suggested`, ends its turn and stays in its session |
| approve | `{{cli}} handoff <sandbox>`, or the user approves in the container's tab. For an end-to-end task, `{{cli}} handoff <sandbox> --continue` approves and sends the stock continue in one command: "{{continue}}" |
| after approval | `attention:` reads `session handoff complete; fresh session idle`; the fresh session holds only a hidden pointer to the task directory, and on a manual task waits for the user's next message |
| decline | the steer that sends the container on replaces the suggestion at its next `status.md` update |
