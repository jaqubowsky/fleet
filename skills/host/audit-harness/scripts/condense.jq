def t(n): tostring | if length > n then .[0:n] + "…[+" + ((length - n)|tostring) + "]" else . end;
def flat: if type=="string" then . elif type=="array" then (map(if type=="object" then (if .type=="text" then .text elif .type=="image" then "[image]" elif .type=="tool_reference" then ("[tool_ref " + (.tool_name // "") + "]") else (.|tostring) end) else tostring end) | join(" ")) else tostring end;
input_line_number as $ln
| . as $o
| ($o.timestamp // "" | .[0:19]) as $ts
| if $o.type=="user" then
    ($o.message.content) as $c
    | if ($c|type)=="string" then "L\($ln) \($ts) U: \($c|t(2500))"
      else ($c[]? |
        if .type=="text" then "L\($ln) \($ts) U: \(.text|t(2500))"
        elif .type=="tool_result" then
          (.content|flat) as $r
          | if .is_error then "L\($ln) R!ERR: \($r|t(900))" else "L\($ln) R: \($r|t(260))" end
        else empty end)
      end
  elif $o.type=="assistant" then
    ($o.message.content[]? |
      if .type=="text" then "L\($ln) \($ts) A: \(.text|t(1500))"
      elif .type=="tool_use" then "L\($ln) T \(.name): \(.input|tostring|t(420))"
      else empty end)
  elif $o.type=="system" then "L\($ln) SYS \($o.subtype // ""): \(($o.content // "")|tostring|t(300))"
  elif $o.type=="attachment" then
     ($o.attachment.type // "") as $at
     | if $at=="instructions" or $at=="skill_listing" or $at=="deferred_tools_delta" or $at=="mcp_instructions_delta" then empty
       else "L\($ln) ATT \($at): \($o.attachment|tostring|t(300))" end
  else empty end
