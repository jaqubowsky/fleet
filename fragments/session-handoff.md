| Step | What happens |
| --- | --- |
| suggest | the container sets `attention:` to `session handoff suggested; approve with {{handoff.command}}`, ends its turn and stays in its session |
| approve | `{{cli}} steer <sandbox> "{{handoff.command}}"`, or the user types {{handoff.command}} in the container's tab. {{handoff.continue}} |
| after approval | `attention:` reads `session handoff complete; fresh session idle`; the fresh session holds only a hidden pointer to the task directory, and on a manual task waits for the user's next message |
| decline | the steer that sends the container on replaces the suggestion at its next `status.md` update |
