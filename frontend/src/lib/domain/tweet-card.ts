/** The compact post the feed card renders: only what it shows, nothing to sanitise later. */
export type TweetSegment =
	| { type: 'text'; text: string }
	| { type: 'link' | 'mention' | 'hashtag' | 'symbol'; text: string; href: string };
export type TweetMediaItem = {
	kind: 'photo' | 'video' | 'gif';
	/** Still image: the photo itself, or the video's poster frame. */
	image: string;
	width: number;
	height: number;
	alt: string;
	/** MP4 source for videos and GIFs. */
	video: string | null;
};
export type TweetAuthor = {
	name: string;
	handle: string;
	avatar: string;
	verified: boolean;
};
export type TweetCardData = {
	id: string;
	url: string;
	author: TweetAuthor;
	replyTo: string | null;
	segments: TweetSegment[];
	media: TweetMediaItem[];
	quoted: {
		url: string;
		author: TweetAuthor;
		segments: TweetSegment[];
		media: TweetMediaItem[];
	} | null;
};
