"""Preserve a clip's original text while updating its current transcript."""


def ensure_original_transcript(call):
    """Keep a saved original; use null until a call has published wording."""
    original = call.get('original_transcript')
    if original is not None and not isinstance(original, str):
        raise ValueError('Original transcript must be text or null')
    if original is None:
        current = call.get('transcript')
        call['original_transcript'] = current if isinstance(current, str) and current.strip() else None
    return call


def set_transcript(call, text, validated=None):
    if not isinstance(text, str) or not text.strip():
        raise ValueError('A transcript or honest uncertainty annotation is required')
    if validated is not None and not isinstance(validated, bool):
        raise ValueError('validated must be a boolean')
    ensure_original_transcript(call)
    if call['original_transcript'] is None:
        call['original_transcript'] = text
    call['transcript'] = text
    if validated is not None:
        call['validated'] = validated
    return call
