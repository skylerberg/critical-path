#compdef cpath
# zsh completion for cpath. Install with: cpath completion -s zsh > "${fpath[1]}/_cpath"
# or, after compinit: eval "$(cpath completion -s zsh)"

_cpath() {
  local -a lines vals disp
  local line value desc
  lines=("${(@f)$(cpath __complete -- "${(@)words[1,CURRENT]}" 2>/dev/null)}")
  if (( ${#lines} == 1 )) && [[ ${lines[1]} == ':files' ]]; then
    _files
    return
  fi
  for line in "${lines[@]}"; do
    [[ -z $line ]] && continue
    value=${line%%$'\t'*}
    desc=${line#*$'\t'}
    vals+=("$value")
    if [[ -n $desc ]]; then
      disp+=("$value -- $desc")
    else
      disp+=("$value")
    fi
  done
  (( ${#vals} )) || return 1
  compadd -U -l -d disp -a vals
}

if [[ $funcstack[1] == _cpath ]]; then
  _cpath "$@"
else
  compdef _cpath cpath
fi
