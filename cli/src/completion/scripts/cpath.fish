# fish completion for cpath.
# Install with: cpath completion -s fish > ~/.config/fish/completions/cpath.fish

function __cpath_complete
    set -l tokens (commandline --cut-at-cursor --current-process --tokens-expanded 2>/dev/null; or commandline -opc)
    set -l current (commandline -ct)
    set -l out (cpath __complete -- $tokens "$current" 2>/dev/null)
    if test (count $out) -eq 1; and test "$out[1]" = ':files'
        __fish_complete_path "$current"
        return
    end
    printf '%s\n' $out
end

complete -c cpath -f -a '(__cpath_complete)'
