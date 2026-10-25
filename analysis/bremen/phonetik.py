import re

VOWELS = set("AEIJOUY")
C_HARD_AT_START = set("AHKLOQRUX")
C_HARD_INSIDE = set("AHKOQUX")
FOLD = str.maketrans({"Ä": "A", "Ö": "O", "Ü": "U", "ß": "S", "É": "E", "È": "E", "Á": "A", "À": "A", "Ó": "O", "Ú": "U", "Í": "I"})
REPEATED_DIGIT = re.compile(r"(\d)\1+")


def koelner_phonetik(name: str | None) -> str | None:
    if not name:
        return None
    word = re.sub(r"[^A-Z]", "", name.upper().translate(FOLD))
    if not word:
        return None
    digits = "".join(letter_code(word, i) for i in range(len(word)))
    collapsed = REPEATED_DIGIT.sub(r"\1", digits)
    return (collapsed[:1] + collapsed[1:].replace("0", "")) or None


def letter_code(word: str, i: int) -> str:
    letter = word[i]
    before = word[i - 1] if i > 0 else ""
    after = word[i + 1] if i + 1 < len(word) else ""
    if letter in VOWELS:
        return "0"
    if letter == "H":
        return ""
    if letter == "B":
        return "1"
    if letter == "P":
        return "3" if after == "H" else "1"
    if letter in "DT":
        return "8" if after in ("C", "S", "Z") else "2"
    if letter in "FVW":
        return "3"
    if letter in "GKQ":
        return "4"
    if letter == "C":
        if i == 0:
            return "4" if after in C_HARD_AT_START else "8"
        if before in ("S", "Z"):
            return "8"
        return "4" if after in C_HARD_INSIDE else "8"
    if letter == "X":
        return "8" if before in ("C", "K", "Q") else "48"
    if letter == "L":
        return "5"
    if letter in "MN":
        return "6"
    if letter == "R":
        return "7"
    if letter in "SZ":
        return "8"
    return ""
