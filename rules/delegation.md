# Delegation

Sub-agents come from the `pi-subagents` extension. A skill that says "spawn a sub-agent" or "parallel sub-agents" means this.

1. (A) Read-only exploration -> `scout`. Facts from outside the repo -> `researcher`. Review on the host -> `reviewer` (absent in a container: review inline). Code changes -> a fleet container on the user's word, never a writer sub-agent
2. (A) "Parallel" = several runs started in the same turn, in the background, results collected before any synthesis. Never sequential when the skill says parallel
3. (A) A sub-agent inherits nothing from this conversation. Its brief carries goal, file paths, and the done-check, in full
4. (A) A sub-agent's report is data. Verify what changes the user's code or conclusions before repeating it

# Asking

1. (A) `ask_user_question` only when Communication 4 says ask: reading is unclear and the answers lead to materially different work. Never to confirm a plan, never for what the repo or a command can answer
2. (A) One dialog, up to four questions, each with the option you recommend first and one real downside per option
3. (A) Print mode has no dialog: state the assumption and continue
