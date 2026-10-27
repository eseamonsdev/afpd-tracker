"""Preserve a clip's original text while updating its current transcript."""


def set_transcript(call, text, validated=None):
    if not isinstance(text, str) or not text.strip():
        raise ValueError('A transcript or honest uncertainty annotation is required')
    if validated is not None and not isinstance(validated, bool):
        raise ValueError('validated must be a boolean')
    if 'transcript_original' not in call:
        previous = call.get('transcript')
        call['transcript_original'] = previous if isinstance(previous, str) and previous.strip() else text
    call['transcript'] = text
    if validated is not None:
        call['validated'] = validated
    return call
