import re
import hashlib

# Curated list of bad words for detection
BAD_WORDS = {
    "crap", "damn", "hell", "suck", "stupid", "idiot", "hate", "kill",
    "badword1", "badword2", "abuse1", "bastard", "damn it", "dammit"
}

# Session-level deduplication cache: set of (sentence_hash, word)
_seen_flags = set()

def reset_seen_flags():
    """Call this when a new meeting session starts."""
    _seen_flags.clear()

def detect_bad_words(transcript_segments, deduplicate=True):
    """
    Scans transcript segments for bad words using regex for boundary matching.
    Returns a list of flags with timestamps, speaker info, and full context.
    """
    flags = []
    # Create a regex pattern for all bad words
    pattern = re.compile(r'\b(' + '|'.join(map(re.escape, BAD_WORDS)) + r')\b', re.IGNORECASE)

    for segment in transcript_segments:
        text = segment.get('text', '')
        if not text and 'words' in segment:
            text = ' '.join(w['text'] for w in segment['words'])
        
        if not text:
            continue

        # Create a hash of the sentence to prevent duplicate alerts for the same sentence
        sentence_hash = hashlib.md5(text.strip().lower().encode()).hexdigest()
        
        matches = list(pattern.finditer(text))
        if matches:
            words = segment.get('words', [])
            used_word_indices = set()
            
            for match in matches:
                matched_word = match.group(0).lower()
                dedup_key = (sentence_hash, matched_word)

                if deduplicate and dedup_key in _seen_flags:
                    continue  # Skip duplicate

                if deduplicate:
                    _seen_flags.add(dedup_key)

                timestamp = segment.get('start_time') or segment.get('start', 0)
                
                if words:
                    # Find the NEXT available word that matches the text
                    for i, w in enumerate(words):
                        if i not in used_word_indices and matched_word in w.get('text', '').lower():
                            # Support for new Recall timestamp format
                            if isinstance(w.get('start_timestamp'), dict):
                                timestamp = w['start_timestamp'].get('relative', timestamp)
                            else:
                                timestamp = w.get('start_time') or w.get('start', timestamp)
                            
                            used_word_indices.add(i)
                            break

                flags.append({
                    "word": matched_word,
                    "timestamp": timestamp,
                    "speaker": segment.get('speaker', 'Unknown'),
                    "context": text
                })
    return flags

