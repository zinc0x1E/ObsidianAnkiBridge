import { Blueprint } from 'ankibridge/blueprints/base'
import { NotesInfoResponseEntity } from 'ankibridge/entities/network'
import {
    AnkiFields,
    Media,
    ModelName,
    NoteField,
    NoteFields,
    SourceDescriptor,
} from 'ankibridge/entities/note'
import AnkiBridgePlugin from 'ankibridge/main'
import { getDefaultDeckForFolder } from 'ankibridge/utils/file'
import yup from 'ankibridge/utils/yup'
import { Type, load } from 'js-yaml'
import { get } from 'lodash'
import { App, Notice, getAllTags } from 'obsidian'

// Config
export interface Config {
    deck?: string
    tags?: Array<string>
    delete?: boolean
    enabled?: boolean
    cloze?: boolean
    clozeReplacements?: Array<string>
}

export interface ParseConfig extends Config {
    id: number | null
}
export class ParseConfig {
    public static async fromResult(result: ParseNoteResult): Promise<ParseConfig> {
        const configStr = result.config || ''
        const configObj: ParseConfig = <ParseConfig>load(configStr) || { id: null }

        const validatedConfig: ParseConfig = await ParseConfigSchema.validate(configObj)

        return validatedConfig
    }
}
export const ParseConfigSchema: yup.SchemaOf<ParseConfig> = yup.object({
    id: yup.number().nullable().defined().default(null),
    deck: yup.string().emptyAsUndefined().nullAsUndefined(),
    tags: yup.array().of(yup.string()).notRequired(),
    delete: yup.boolean().nullAsUndefined(),
    enabled: yup.boolean().nullAsUndefined(),
    cloze: yup.boolean().nullAsUndefined(),
    clozeReplacements: yup.array().of(yup.string()).notRequired(),
})

// Location
export interface ParseLocationMarker {
    offset: number
    line: number
    column: number
}
export const ParseLocationMarkerSchema: yup.SchemaOf<ParseLocationMarker> = yup.object({
    offset: yup.number().defined(),
    line: yup.number().defined(),
    column: yup.number().defined(),
})

export interface ParseLocation {
    start: ParseLocationMarker
    end: ParseLocationMarker
    source?: string
}
export const ParseLocationSchema: yup.SchemaOf<ParseLocation> = yup.object({
    start: ParseLocationMarkerSchema,
    end: ParseLocationMarkerSchema,
    source: yup.string(),
})

// Result
export interface ParseLineResult {
    type: string
    text: string
}

export const ParseLineResultSchema: yup.SchemaOf<ParseLineResult> = yup.object({
    type: yup.string().defined(),
    text: yup.string().defined(),
})

export interface ParseNoteResult {
    type: string
    config: string | null
    front: string | null
    back: string | null
    location: ParseLocation
}
export const ParseNoteResultSchema: yup.SchemaOf<ParseNoteResult> = yup.object({
    type: yup.string().defined(),
    config: yup.string().nullable().defined(),
    front: yup.string().nullable().defined(),
    back: yup.string().nullable().defined(),
    location: ParseLocationSchema,
})

export abstract class NoteBase {
    public config: Config
    public medias: Array<Media>
    public isCloze: boolean

    constructor(
        public blueprint: Blueprint,
        public id: number | null,
        public fields: NoteFields,
        public source: SourceDescriptor,
        public sourceText: string,
        {
            config,
            medias = [],
            isCloze = false,
        }: {
            config: Config
            medias?: Array<Media>
            isCloze?: boolean
        },
    ) {
        this.config = config
        this.medias = medias
        this.isCloze = isCloze
    }

    public renderAsText(): string {
        return this.blueprint.renderAsText(this)
    }

    public fieldsToAnkiFields(fields: NoteFields, plugin: AnkiBridgePlugin): AnkiFields {
        let namesPack = undefined
        if (this.isCloze) {
            namesPack = plugin.settings.clozeNoteTypeNames
        } else {
            namesPack = plugin.settings.basicNoteTypeNames
        }

        return {
            [namesPack.fieldNames.frontLike]: fields[NoteField.Frontlike] || '',
            [namesPack.fieldNames.backLike]: fields[NoteField.Backlike] || ''
        }
    }

    public normaliseNoteInfoFields(noteInfo: NotesInfoResponseEntity, plugin: AnkiBridgePlugin): NoteFields {
        const isCloze = noteInfo.modelName === plugin.settings.clozeNoteTypeNames.noteTypeName
        const namesPack = isCloze ? plugin.settings.clozeNoteTypeNames : plugin.settings.basicNoteTypeNames

        const frontlike = namesPack.fieldNames.frontLike
        const backlike = namesPack.fieldNames.backLike

        return {
            [NoteField.Frontlike]: noteInfo.fields[frontlike].value,
            [NoteField.Backlike]: noteInfo.fields[backlike].value,
        }
    }

    public shouldUpdateFile(): boolean {
        return this.getEnabled() && this.renderAsText() !== this.sourceText
    }

    public getModelName(plugin: AnkiBridgePlugin): ModelName {
        if (this.isCloze) {
            return plugin.settings.clozeNoteTypeNames.noteTypeName
        }

        return plugin.settings.basicNoteTypeNames.noteTypeName
    }

    /**
     * Returns the resolved deck name
     */
    public getDeckName(plugin: AnkiBridgePlugin): string {
        // Use in-note configured deck
        if (this.config.deck) {
            return this.config.deck
        }

        // Try to resolve based on default deck mappings
        const resolvedDefaultDeck = getDefaultDeckForFolder(
            this.source.file.parent,
            plugin.settings.defaultDeckMaps,
        )
        if (resolvedDefaultDeck) {
            return resolvedDefaultDeck
        }

        // Fallback if no deck was found
        return plugin.settings.fallbackDeck
    }

    public getTags(plugin: AnkiBridgePlugin): Array<string> {
        const cache = plugin.app.metadataCache.getFileCache(this.source.file)
        if (plugin.settings.inheritTags === false || !cache || getAllTags(cache) === null) {
            return [plugin.settings.tagInAnki, ...(this.config.tags || [])]
        }

        const tags = ((getAllTags(cache)) as string[])
            .map(tag => tag.replace('#', '')) // Strip out the hash symbol
            .map(tag => tag.replaceAll('/', '::')) // Convert hierarchial tags to anki format
            .concat(this.config.tags || []) // Add configured tags
            .concat(plugin.settings.tagInAnki) // Add configured tags

        const tagsUnique = [...new Set(tags)]

        return tagsUnique || []
    }

    public getEnabled(): boolean {
        return this.config.enabled === undefined || this.config.enabled
    }
}

export interface NoteWithID extends NoteBase {
    id: number
}

export function hasID(note: NoteBase | NoteWithID): note is NoteWithID {
    return note.id !== null
}
