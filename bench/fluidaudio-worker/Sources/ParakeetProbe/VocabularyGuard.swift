import AppKit
import Foundation

/// Keeps a vocabulary replacement only where it rewrites words the spell checker does not know.
/// Mirrors the guard proposed for ParakeetPlugin, so the probe measures the same rule.
enum VocabularyGuard {
    enum Rule: String, CaseIterable {
        /// Refuse a change when any word it rewrites is a known word.
        case strict
        /// Refuse a change only when every word it rewrites is a known word.
        case lenient
        /// Lenient, and a known word may only disappear into a term that spells it ("SQL" in PostgreSQL).
        case contained
    }

    static func filter(
        original: String,
        rescored: String,
        rule: Rule,
        isKnownWord: (String) -> Bool
    ) -> String {
        guard original != rescored else { return original }
        let before = original.split(whereSeparator: \.isWhitespace).map(String.init)
        let after = rescored.split(whereSeparator: \.isWhitespace).map(String.init)
        let difference = after.map(key).difference(from: before.map(key))
        var removed = Set<Int>()
        var inserted = Set<Int>()
        for change in difference {
            switch change {
            case let .remove(offset, _, _): removed.insert(offset)
            case let .insert(offset, _, _): inserted.insert(offset)
            }
        }

        var output: [String] = []
        var i = 0
        var j = 0
        while i < before.count || j < after.count {
            if i < before.count, j < after.count, !removed.contains(i), !inserted.contains(j) {
                output.append(before[i])
                i += 1
                j += 1
                continue
            }
            var replaced: [String] = []
            var replacement: [String] = []
            while (i < before.count && removed.contains(i)) || (j < after.count && inserted.contains(j)) {
                while i < before.count, removed.contains(i) { replaced.append(before[i]); i += 1 }
                while j < after.count, inserted.contains(j) { replacement.append(after[j]); j += 1 }
            }
            if accepts(replaced: replaced, replacement: replacement, rule: rule, isKnownWord: isKnownWord) {
                output += carryingTrailingPunctuation(from: replaced, to: replacement)
            } else {
                output += replaced
            }
        }
        return output.joined(separator: " ")
    }

    static func accepts(
        replaced: [String],
        replacement: [String],
        rule: Rule,
        isKnownWord: (String) -> Bool
    ) -> Bool {
        guard !replaced.isEmpty, !replacement.isEmpty else { return false }
        if letters(replaced.joined()) == letters(replacement.joined()) { return true }
        let known = replaced.map { word in
            let bare = key(word)
            return !bare.contains(where: \.isLetter) || isKnownWord(bare)
        }
        switch rule {
        case .strict: return !known.contains(true)
        case .lenient: return known.contains(false)
        case .contained:
            let term = letters(replacement.joined())
            return known.contains(false) && zip(replaced, known).allSatisfy { word, isKnown in
                !isKnown || term.contains(letters(word))
            }
        }
    }

    /// The rescorer drops the punctuation of a word it replaces: "to Tasmine." becomes "to Tasmeen".
    static func carryingTrailingPunctuation(from replaced: [String], to replacement: [String]) -> [String] {
        guard let last = replaced.last, let newLast = replacement.last else { return replacement }
        let trailing = String(last.reversed().prefix { $0.isPunctuation }.reversed())
        guard !trailing.isEmpty, !(newLast.last?.isPunctuation ?? false) else { return replacement }
        return replacement.dropLast() + [newLast + trailing]
    }

    private static func key(_ word: String) -> String {
        word.trimmingCharacters(in: .punctuationCharacters.union(.symbols))
    }

    private static func letters(_ text: String) -> String {
        String(text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
            .filter { $0.isLetter || $0.isNumber })
    }
}

/// A word counts as known when the system spell checker accepts it in any of the given languages.
@MainActor
func spellCheckerKnows(_ word: String, languages: [String]) -> Bool {
    let checker = NSSpellChecker.shared
    return languages.contains { language in
        checker.checkSpelling(
            of: word, startingAt: 0, language: language, wrap: false, inSpellDocumentWithTag: 0, wordCount: nil
        ).location == NSNotFound
    }
}
