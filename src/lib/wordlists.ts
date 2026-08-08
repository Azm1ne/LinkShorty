/**
 * Curated wordlists for auto-generated slugs. The format is
 * `adjective-noun-adjective`. Total combinations: ~200 * ~200 * ~200 = ~8M.
 *
 * Why hand-curated: random dictionary words will eventually produce an
 * unfortunate pairing and hand it to a user. Keep these concrete, neutral,
 * and boring. If you add or remove words, recompute the combos count using
 * `adjectives.length * nouns.length * adjectives.length`.
 *
 * Rule of thumb for additions: no names, no poetic/loaded words, no homophones
 * with offensive terms, no words that change meaning when juxtaposed with
 * other entries in the list.
 */

export const ADJECTIVES = [
  "amber", "ancient", "autumn", "balanced", "blue", "brave", "bright", "brisk",
  "calm", "clear", "cold", "cool", "crimson", "crisp", "curious", "dapper",
  "daring", "dusky", "early", "easy", "elder", "empty", "even", "exact",
  "fair", "far", "fast", "fine", "firm", "fleet", "fond", "free",
  "fresh", "full", "gentle", "glad", "gold", "golden", "good", "grand",
  "gray", "great", "green", "gusty", "hale", "happy", "hardy", "humble",
  "icy", "inner", "jade", "jolly", "keen", "kind", "laced", "late",
  "lazy", "lean", "light", "little", "lively", "lone", "long", "lucky",
  "lunar", "mellow", "merry", "mild", "misty", "mixed", "mute", "narrow",
  "neat", "new", "nice", "nimble", "noble", "open", "outer", "pale",
  "patient", "plain", "plum", "plump", "polar", "polite", "prime", "proud",
  "pure", "quick", "quiet", "rare", "ready", "real", "red", "rich",
  "ripe", "rosy", "round", "royal", "rusty", "sage", "sandy", "sharp",
  "short", "shy", "silent", "silver", "simple", "sleek", "slow", "small",
  "smart", "smooth", "solar", "solid", "south", "spare", "spry", "stark",
  "still", "stone", "stoic", "stormy", "stout", "sunny", "sure", "swift",
  "tall", "tame", "tidy", "tiny", "tireless", "true", "twin", "steady",
  "vast", "velvet", "vivid", "warm", "wee", "west", "wide", "wild",
  "wise", "young", "zesty", "bright", "eager", "fair", "hazel", "ivory",
  "jovial", "kindly", "lush", "modest", "north", "olive", "pearl", "ruby",
  "soft", "sour", "tangy", "unseen", "violet", "warm", "yearly", "zealous",
] as const;

export const NOUNS = [
  "apple", "archer", "arrow", "atlas", "badger", "basin", "beacon", "birch",
  "bison", "blossom", "bridge", "brook", "canyon", "cedar", "cinder", "clay",
  "cliff", "cloud", "cobble", "comet", "condor", "copper", "coral", "crane",
  "crater", "creek", "cricket", "crimson", "cypress", "daisy", "dawn", "delta",
  "diamond", "dune", "eagle", "ember", "falcon", "feather", "field", "finch",
  "fjord", "forest", "fossil", "garden", "geyser", "ginger", "glacier", "granite",
  "harbor", "harvest", "hawk", "hazel", "heather", "heron", "hill", "hollow",
  "horizon", "ivy", "jaguar", "jasper", "juniper", "kestrel", "lake", "lark",
  "laurel", "leaf", "lemon", "lichen", "lighthouse", "lotus", "lupine", "marble",
  "marsh", "meadow", "mercury", "meteor", "mint", "mist", "moon", "morning",
  "mosaic", "moth", "mountain", "needle", "nettle", "north", "oak", "ocean",
  "onyx", "opal", "orchid", "otter", "owl", "paloma", "pebble", "pine",
  "planet", "plume", "prairie", "quartz", "quill", "rabbit", "rain", "raven",
  "reef", "ridge", "river", "robin", "rose", "rust", "sage", "sail",
  "salt", "sapphire", "scarlet", "shadow", "shell", "shore", "silver", "snow",
  "sparrow", "spider", "spruce", "stone", "storm", "stream", "summit", "sun",
  "swallow", "sycamore", "tide", "tiger", "topaz", "trail", "tulip", "valley",
  "vine", "violet", "willow", "winter", "wren", "yarrow", "yew", "zephyr",
] as const;

export const ORDINALS = [
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
] as const;