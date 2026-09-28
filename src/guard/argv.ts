const DELEGATED_SEGMENT = /^\s*sbx\s+(exec|run)(\s|$)/;
const KEYWORD = /^(then|do|else|if|elif|while|until|!|\{|[A-Za-z_][A-Za-z0-9_]*=.*)$/s;
const WRAPPER = /^(?:\S*\/)?(sudo|command|exec|time|env|xargs|nohup|timeout|nice)$/;
const VALUED: Record<string, { short: string; long: string[] }> = {
	sudo: { short: "ugpCDrtUhTRca", long: ["user", "group", "prompt", "chdir", "role", "type", "other-user", "host", "command-timeout", "close-from", "chroot", "login-class", "auth-type"] },
	env: { short: "uCP", long: ["unset", "chdir"] },
	timeout: { short: "sk", long: ["signal", "kill-after"] },
	nice: { short: "n", long: ["adjustment"] },
};
const SPLIT = /^(-S|--split-string)(=?)(.*)$/s;
const SHELL = /^(\S*\/)?(ba|z|da|k)?sh$/;
const INTERPRETER = /(^|[|;&\t ])((ba|z)?sh|python3?|node|perl|ruby|env)([\t ]|$)/;

export function scan(subject: string): string {
	const kept: string[] = [];
	let delim = "";
	let keep = false;

	for (const line of subject.split("\n")) {
		if (delim) {
			if (line.trim() === delim) delim = "";
			else if (keep) kept.push(line);
			continue;
		}

		kept.push(line);
		const at = line.indexOf("<<");
		if (at < 0) continue;

		const rest = line.slice(at + 2).replace(/^-/, "");
		const quote = rest[0];
		if (quote !== "'" && quote !== '"') continue;

		const end = rest.indexOf(quote, 1);
		if (end < 2) continue;

		delim = rest.slice(1, end);
		keep = INTERPRETER.test(line);
	}

	return kept.join("\n");
}

type Segment = { text: string; piped: boolean };

function segmentsOf(subject: string, withDelegated: boolean): Segment[] {
	const segments: Segment[] = [];
	const substitutions: boolean[] = [];
	let quote = "";
	let current = "";
	let redirect = -1;
	let piped = false;
	const cut = (pipe = false) => {
		segments.push({ text: withDelegated || !DELEGATED_SEGMENT.test(current) ? current : redirect < 0 ? "" : current.slice(redirect), piped });
		current = "";
		redirect = -1;
		piped = pipe;
	};
	for (let i = 0; i < subject.length; i++) {
		const char = subject[i];
		if (quote === "'") {
			if (char === quote) quote = "";
		} else if (char === "\x60" || (/[$<>]/.test(char) && subject[i + 1] === "(")) {
			cut();
			if (char !== "\x60") {
				substitutions.push(true);
				i++;
			}
			continue;
		} else if (char === ")" && substitutions.length) {
			if (substitutions.pop()) {
				cut();
				continue;
			}
		} else if (char === "\\") {
			current += char + (subject[i + 1] ?? "");
			i++;
			continue;
		} else if (quote) {
			if (char === quote) quote = "";
		} else if (char === "'" || char === '"') quote = char;
		else if (char === "(") substitutions.push(false);
		else if (char === "#" && (i === 0 || /[\s;&|(]/.test(subject[i - 1]))) {
			const end = subject.indexOf("\n", i);
			i = (end < 0 ? subject.length : end) - 1;
			continue;
		} else if (";&|\n".includes(char) && !(char === "&" && (/[<>]/.test(subject[i - 1]) || subject[i + 1] === ">"))) {
			cut(char === "|" && subject[i - 1] !== "|" && subject[i + 1] !== "|");
			continue;
		} else if (/[<>]/.test(char) && redirect < 0) redirect = current.length;
		current += char;
	}
	cut();

	return segments;
}

export function hostCommands(subject: string): string[] {
	return segmentsOf(subject, false).map(({ text }) => text);
}

export function commandsOf(subject: string): string[] {
	return hostCommands(scan(subject));
}

function words(text: string): string[] {
	const found: string[] = [];
	let word: string | undefined;
	let quote = "";
	const add = (chars: string) => {
		word = (word ?? "") + chars;
	};
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (quote === "'") {
			if (char === quote) quote = "";
			else add(char);
		} else if (char === "\\") {
			if (text[i + 1] !== "\n") add(text[i + 1] ?? "");
			i++;
		} else if (quote) {
			if (char === quote) quote = "";
			else add(char);
		} else if (char === "'" || char === '"') {
			add("");
			quote = char;
		} else if (char === "$" && text[i + 1] === "'") continue;
		else if (/[\s()]/.test(char)) {
			if (word !== undefined) found.push(word);
			word = undefined;
		} else add(char);
	}
	if (word !== undefined) found.push(word);

	return found;
}

type Program = { argv: string[]; piped: boolean };

function argvs(subject: string, withDelegated: boolean): Program[] {
	return segmentsOf(scan(subject), withDelegated).flatMap(({ text, piped }) => {
		let argv = words(text);
		for (;;) {
			if (KEYWORD.test(argv[0] ?? "")) argv = argv.slice(1);
			else if (WRAPPER.test(argv[0] ?? "")) argv = unwrapped(argv); else if (withDelegated && argv[0] === "sbx" && /^(exec|run|cp)$/.test(argv[1] ?? "")) argv = argv.slice(3);
			else break;
		}

		const script = argv[0] === "herdr" ? argv.slice(2).join(" ") : argv[0] === "eval" ? argv.slice(1).join(" ") : SHELL.test(argv[0] ?? "") ? shellScript(argv) : "";

		return script ? [{ argv, piped }, ...argvs(script, withDelegated)] : [{ argv, piped }];
	});
}

export function programs(subject: string, withDelegated: boolean): string[] {
	return argvs(subject, withDelegated).map(({ argv, piped }) => `${piped ? "| " : ""}${argv.map((word) => word.replace(/[;&|\n]/g, " ")).join(" ")}`);
}

export function argvsOf(subject: string): string[][] {
	return argvs(subject, false).map(({ argv }) => argv);
}

function unwrapped(argv: string[]): string[] {
	const wrapper = argv[0].replace(WRAPPER, "$1");
	let rest = argv.slice(1);
	while (rest[0]?.startsWith("-") && rest[0] !== "-") {
		const [option] = rest;
		const split = wrapper === "env" ? option.match(SPLIT) : null;
		if (split) return [...words(split[3] || (split[2] ? "" : (rest[1] ?? ""))), ...rest.slice(split[3] || split[2] ? 1 : 2)];
		rest = rest.slice(1);
		if (option === "--") break;
		if (takesValue(VALUED[wrapper], option)) rest = rest.slice(1);
	}
	return wrapper === "timeout" ? rest.slice(1) : rest;
}

function takesValue(valued: { short: string; long: string[] } | undefined, option: string): boolean {
	if (!valued) return false;
	if (option.startsWith("--")) return !option.includes("=") && valued.long.includes(option.slice(2));
	const cluster = option.slice(1);
	const first = [...cluster].findIndex((letter) => valued.short.includes(letter));
	return first === cluster.length - 1;
}

function shellScript(argv: string[]): string {
	const options = argv.slice(1).findIndex((word) => !word.startsWith("-") || word === "--");
	const flags = options < 0 ? argv.slice(1) : argv.slice(1, options + 1);

	return flags.some((flag) => /^-[A-Za-z]*c/.test(flag)) && options >= 0 ? argv[options + 1] : "";
}
