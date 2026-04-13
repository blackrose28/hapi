idle_polls = 0
max_idle_polls = 120

if not messages:
    idle_polls += 1
    if idle_polls >= max_idle_polls:
        state.done = True
        break
else:
    idle_polls = 0