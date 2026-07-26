# bash completion for cpath. Install with: eval "$(cpath completion -s bash)"
_cpath() {
  local line
  COMPREPLY=()
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "$line" ] && continue
    if [ "$line" = ":files" ]; then
      COMPREPLY=()
      return 0
    fi
    COMPREPLY[${#COMPREPLY[@]}]=$(printf '%q' "${line%%$'\t'*}")
  done < <(cpath __complete -- "${COMP_WORDS[@]:0:COMP_CWORD+1}" 2>/dev/null)
}

complete -o default -o bashdefault -F _cpath cpath
