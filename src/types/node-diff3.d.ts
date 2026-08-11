declare module "node-diff3" {
	export interface MergeRegion<T> {
		ok?: T[];
		conflict?: {
			a: T[];
			o: T[];
			b: T[];
		};
	}

	export function diff3Merge<T = string>(
		a: string | T[],
		o: string | T[],
		b: string | T[],
		options?: { excludeFalseConflicts?: boolean; stringSeparator?: string | RegExp }
	): MergeRegion<T>[];
}
