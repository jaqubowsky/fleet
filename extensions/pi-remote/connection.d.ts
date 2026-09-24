export declare const CREDENTIAL: RegExp;
export declare function credential(
	location: { hash: string; pathname: string },
	history: { replaceState(state: null, unused: string, url: string): void },
	storage: { getItem(key: string): string | null; setItem(key: string, value: string): void },
): string;
export declare function deliberate(error: unknown, aborted: boolean): boolean;
export declare function terminal(message: string): boolean;
