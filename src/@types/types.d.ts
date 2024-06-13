declare module 'usfm-js' {
    export function toJSON(input: string): USFMBook
}

type USFMBook = {
    code: string
    headers: USFMHeader[]
    chapters: {
        [chapterNumber: string]: USFMChapter
    }
}

type USFMHeader = {
    tag: string;
    content?: string;
};

type USFMChapter = {
    [verseNumber: string]: USFMVerse;
    front: USFMVerse
};

type USFMVerse = {
    verseObjects: USFMVerseObject[];
};


type Footnote = {
    tag: 'f';
    type: 'footnote';
    content: string;
    endTag: string;
};

type Text = {
    type: 'text';
    text: string;
};

type USFMVerseObject = {
    tag?: char;
    type: string;
    content?: string;
    endTag?: string;
    text?: string;
    nextChar?: string

};

type Book = {
    id: string
    name: string
    shortName: string
    chapterCount: number
    chapters?: Chapter[]
}

type Chapter = {
    bookId: Book['id']
    number: number
    introduction?: string
    verses?: Verse[]
}

type Verse = {
    bookId: Book['id']
    chapterNumber: Chapter['number']
    number: number
    text: (_Text | Section | Paragraph | Quote)[]
}

type Section = {
    type: 'section'
    text: string
}

type _Text = {
    type: 'text'
    text: string
}

type Paragraph = {
    type: 'paragraph'
    text: string
}

type Quote = {
    type: 'quote'
    text: string
}