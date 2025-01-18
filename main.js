const { Plugin, TFile, TFolder, Notice, PluginSettingTab, Setting } = require("obsidian");

class FolderNotesPlugin extends Plugin {
    async onload() {
        console.log("Folder Notes Plugin loaded!");

        // Load settings
        await this.loadSettings();

        // Register settings tab
        this.addSettingTab(new FolderNotesSettingTab(this.app, this));

        // Initialize existing folders and files if enabled
        if (this.settings.initializeOnLoad) {
            await this.initializeExistingFoldersAndFiles();
        }

        // Listen to folder creation
        this.registerEvent(
            this.app.vault.on("create", async (file) => {
                if (file instanceof TFolder) {
                    await this.createFolderNote(file);
                }
            })
        );

        // Listen to note creation
        this.registerEvent(
            this.app.vault.on("create", async (file) => {
                if (file instanceof TFile) {
                    await this.addFolderLinkToNote(file);
                }
            })
        );

        // Listen to file movements
        this.registerEvent(
            this.app.vault.on("rename", async (file, oldPath) => {
                if (file instanceof TFile) {
                    await this.updateFolderLink(file, oldPath);
                }
            })
        );

        // Hide folder notes in the file explorer
        this.registerFileExplorerHider();
    }

    onunload() {
        console.log("Folder Notes Plugin unloaded!");
    }

    /**
     * Load plugin settings.
     */
    async loadSettings() {
        const DEFAULT_SETTINGS = {
            initializeOnLoad: true,
            folderNoteNamingConvention: "{{folderName}}.md"
        };
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * Save plugin settings.
     */
    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * Initialize existing folders and files.
     */
    async initializeExistingFoldersAndFiles() {
        const folders = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFolder);

        for (const folder of folders) {
            await this.createFolderNote(folder);
            await this.linkToParentFolder(folder); // Link folder note to parent folder note
        }

        const files = this.app.vault.getAllLoadedFiles().filter((file) => file instanceof TFile);

        for (const file of files) {
            await this.addFolderLinkToNote(file);
        }

        new Notice("Folder Notes Plugin: Initialization complete.");
    }

    /**
     * Automatically create a folder note for a newly created folder.
     */
    async createFolderNote(folder) {
        const folderNoteName = this.settings.folderNoteNamingConvention.replace(
            "{{folderName}}",
            folder.name
        );
        const folderNotePath = `${folder.path}/${folderNoteName}`;

        console.log(`Checking if folder note exists: ${folderNotePath}`);

        // Check if a folder note already exists
        if (this.app.vault.getAbstractFileByPath(folderNotePath)) {
            console.log(`Folder note already exists: ${folderNotePath}`);
            return; // Do nothing if the file already exists
        }

        try {
            // Create the folder note
            await this.app.vault.create(folderNotePath, `# ${folder.name}`);
            new Notice(`Folder note created for ${folder.name}`);
            console.log(`Folder note created: ${folderNotePath}`);
        } catch (error) {
            if (error.message.includes("File already exists")) {
                console.log(`Error: File already exists at ${folderNotePath}`);
            } else {
                console.error(`Error creating folder note at ${folderNotePath}:`, error);
                throw error; // Re-throw unknown errors
            }
        }
    }

    /**
     * Link a folder note to its parent folder note.
     */
    async linkToParentFolder(folder) {
        const parentFolder = this.getParentFolder(folder);

        if (!parentFolder) return;

        const parentFolderNoteName = this.settings.folderNoteNamingConvention.replace(
            "{{folderName}}",
            parentFolder.name
        );
        const parentFolderNotePath = `${parentFolder.path}/${parentFolderNoteName}`;
        const parentFolderNote = this.app.vault.getAbstractFileByPath(parentFolderNotePath);

        if (!parentFolderNote) return;

        const folderNoteName = this.settings.folderNoteNamingConvention.replace(
            "{{folderName}}",
            folder.name
        );
        const folderNotePath = `${folder.path}/${folderNoteName}`;
        const folderNote = this.app.vault.getAbstractFileByPath(folderNotePath);

        if (!folderNote) return;

        // Read the content of the folder note
        let content = await this.app.vault.read(folderNote);

        // Check if the link to the parent folder note already exists
        if (!content.includes(`[[${parentFolder.name}]]`)) {
            content = `[[${parentFolder.name}]]\n\n${content}`;
            await this.app.vault.modify(folderNote, content);

            new Notice(`Linked ${folder.name} to its parent folder note: ${parentFolder.name}`);
            console.log(`Linked ${folder.name} to its parent folder note: ${parentFolder.name}`);
        }
    }

    /**
     * Automatically add a link to the folder note when a new note is created in a folder.
     */
    async addFolderLinkToNote(note) {
        const parentFolder = this.getParentFolder(note);

        if (!parentFolder) return;

        const folderNoteName = this.settings.folderNoteNamingConvention.replace(
            "{{folderName}}",
            parentFolder.name
        );
        const folderNotePath = `${parentFolder.path}/${folderNoteName}`;
        const folderNote = this.app.vault.getAbstractFileByPath(folderNotePath);

        if (!folderNote) return;

        // Check if the link already exists in the note
        const content = await this.app.vault.read(note);

        if (content.includes(`[[${parentFolder.name}]]`)) {
            return; // Skip if the link already exists
        }

        // Prepend the folder note link to the new note
        const updatedContent = `[[${parentFolder.name}]]\n\n${content}`;
        await this.app.vault.modify(note, updatedContent);

        new Notice(`Linked ${parentFolder.name} in ${note.name}`);
    }

    /**
     * Update folder links when a file is moved to a new folder.
     */
    async updateFolderLink(note, oldPath) {
        const oldParentFolder = this.getParentFolderFromPath(oldPath);
        const newParentFolder = this.getParentFolder(note);

        if (!oldParentFolder || !newParentFolder) return;

        const oldFolderNoteLink = `[[${oldParentFolder.name}]]`;
        const newFolderNoteLink = `[[${newParentFolder.name}]]`;

        let content = await this.app.vault.read(note);

        if (content.includes(oldFolderNoteLink)) {
            content = content.replace(oldFolderNoteLink, newFolderNoteLink);
            await this.app.vault.modify(note, content);

            new Notice(`Updated link to ${newParentFolder.name} in ${note.name}`);
        }
    }

    /**
     * Hide folder notes in the file explorer.
     */
    registerFileExplorerHider() {
        // Dynamically generate a CSS rule based on the naming convention
        const namingPattern = this.settings.folderNoteNamingConvention.replace(
            "{{folderName}}",
            ".*" // Match any folder name
        );

        const cssRule = `
            .nav-file-title[data-path$="${namingPattern}"] {
                display: none !important;
            }
        `;

        const styleEl = document.createElement("style");
        styleEl.textContent = cssRule;
        document.head.appendChild(styleEl);
    }

    /**
     * Get the parent folder of a file or folder.
     */
    getParentFolder(fileOrFolder) {
        const parentPath = fileOrFolder.path.split("/").slice(0, -1).join("/");
        return this.app.vault.getAbstractFileByPath(parentPath);
    }

    /**
     * Get the parent folder of a file from a given path.
     */
    getParentFolderFromPath(path) {
        const parentPath = path.split("/").slice(0, -1).join("/");
        return this.app.vault.getAbstractFileByPath(parentPath);
    }
}

/**
 * Settings tab for the plugin.
 */
class FolderNotesSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;

        containerEl.empty();

        containerEl.createEl("h2", { text: "Folder Notes Plugin Settings" });

        new Setting(containerEl)
            .setName("Initialize on Load")
            .setDesc("Automatically create and manage links for existing folders/files when the plugin loads.")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.initializeOnLoad)
                    .onChange(async (value) => {
                        this.plugin.settings.initializeOnLoad = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Folder Note Naming Convention")
            .setDesc("Customize the naming convention for folder notes (use {{folderName}} as a placeholder).")
            .addText((text) =>
                text
                    .setPlaceholder("e.g., {{folderName}}.md")
                    .setValue(this.plugin.settings.folderNoteNamingConvention)
                    .onChange(async (value) => {
                        this.plugin.settings.folderNoteNamingConvention = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}

module.exports = FolderNotesPlugin;