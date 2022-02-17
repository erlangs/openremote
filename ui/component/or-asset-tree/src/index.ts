import {html, LitElement, PropertyValues, TemplateResult} from "lit";
import {customElement, property, query, state} from "lit/decorators.js";
import "@openremote/or-mwc-components/or-mwc-input";
import {InputType, OrInputChangedEvent, OrMwcInput} from "@openremote/or-mwc-components/or-mwc-input";
import "@openremote/or-icon";
import {
    Asset,
    AssetDescriptor,
    AssetEvent,
    AssetEventCause,
    AssetQuery,
    StringPredicate,
    LogicGroup,
    AttributePredicate,
    AssetQueryMatch,
    AssetsEvent,
    AssetTreeNode,
    AssetTypeInfo,
    Attribute,
    ClientRole,
    SharedEvent,
    WellknownAssets
} from "@openremote/model";
import "@openremote/or-translate";
import {style} from "./style";
import manager, {AssetModelUtil, EventCallback, subscribe, Util} from "@openremote/core";
import Qs from "qs";
import {getAssetDescriptorIconTemplate, OrIcon} from "@openremote/or-icon";
import "@openremote/or-mwc-components/or-mwc-menu";
import {getContentWithMenuTemplate} from "@openremote/or-mwc-components/or-mwc-menu";
import {ListItem} from "@openremote/or-mwc-components/or-mwc-list";
import "@openremote/or-mwc-components/or-mwc-list";
import {i18next} from "@openremote/or-translate";
import "@openremote/or-mwc-components/or-mwc-dialog";

import {
    OrMwcDialog,
    showDialog,
    showErrorDialog,
    showOkCancelDialog
} from "@openremote/or-mwc-components/or-mwc-dialog";
import {OrAddAssetDialog, OrAddChangedEvent} from "./or-add-asset-dialog";
import "./or-add-asset-dialog";

export interface AssetTreeTypeConfig {
    include?: string[];
    exclude?: string[];
}

export interface AssetTreeConfig {
    select?: {
        multiSelect?: boolean;
        types?: string[];
    };
    add?: {
        typesProvider?: (parent: UiAssetTreeNode | undefined) => AssetDescriptor[] | undefined;
        typesParent?: {
            default?: AssetTreeTypeConfig;
            none?: AssetTreeTypeConfig;
            assetTypes?: { [assetType: string]: AssetTreeTypeConfig }
        };
    };
}

interface AssetWithReparentId extends Asset {
    reparentId?: string | null;
}

export interface UiAssetTreeNode extends AssetTreeNode {
    selected: boolean;
    expandable: boolean;
    expanded: boolean;
    parent: UiAssetTreeNode;
    children: UiAssetTreeNode[];
    someChildrenSelected: boolean;
    allChildrenSelected: boolean;
    notMatchingFilter: boolean;
    hidden: boolean;
}

export interface NodeSelectEventDetail {
    oldNodes: UiAssetTreeNode[];
    newNodes: UiAssetTreeNode[];
}

export {style};

export class OrAssetTreeRequestSelectionEvent extends CustomEvent<Util.RequestEventDetail<NodeSelectEventDetail>> {

    public static readonly NAME = "or-asset-tree-request-selection";

    constructor(request: NodeSelectEventDetail) {
        super(OrAssetTreeRequestSelectionEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: {
                allow: true,
                detail: request
            }
        });
    }
}

export class OrAssetTreeSelectionEvent extends CustomEvent<NodeSelectEventDetail> {

    public static readonly NAME = "or-asset-tree-selection";

    constructor(detail: NodeSelectEventDetail) {
        super(OrAssetTreeSelectionEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: detail
        });
    }
}

enum FilterElementType {
    SEARCH_FILTER, ASSET_TYPE,ATTRIBUTE_NAME, ATTRIBUTE_VALUE
}

export type AddEventDetail = {
    sourceAsset?: Asset;
    asset: Asset;
}

export class OrAssetTreeRequestAddEvent extends CustomEvent<Util.RequestEventDetail<AddEventDetail>> {

    public static readonly NAME = "or-asset-tree-request-add";

    constructor(detail: AddEventDetail) {
        super(OrAssetTreeRequestAddEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: {
                allow: true,
                detail: detail
            }
        });
    }
}

export class OrAssetTreeAddEvent extends CustomEvent<AddEventDetail> {

    public static readonly NAME = "or-asset-tree-add";

    constructor(detail: AddEventDetail) {
        super(OrAssetTreeAddEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: detail
        });
    }
}

export class OrAssetTreeRequestDeleteEvent extends CustomEvent<Util.RequestEventDetail<UiAssetTreeNode[]>> {

    public static readonly NAME = "or-asset-tree-request-delete";

    constructor(request: UiAssetTreeNode[]) {
        super(OrAssetTreeRequestDeleteEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: {
                allow: true,
                detail: request
            }
        });
    }
}

export class OrAssetTreeAssetEvent extends CustomEvent<AssetEvent> {

    public static readonly NAME = "or-asset-tree-asset-event";

    constructor(assetEvent: AssetEvent) {
        super(OrAssetTreeAssetEvent.NAME, {
            bubbles: true,
            composed: true,
            detail: assetEvent
        });
    }
}

export class OrAssetTreeFilter {
    asset: string | undefined;
    assetType: string | undefined;
    attribute: string | undefined;
    attributeValue: string | undefined;

    constructor() {
        this.asset = undefined;
        this.assetType = undefined;
        this.attribute = undefined;
        this.attributeValue = undefined;
    }
}

declare global {
    export interface HTMLElementEventMap {
        [OrAssetTreeRequestSelectionEvent.NAME]: OrAssetTreeRequestSelectionEvent;
        [OrAssetTreeSelectionEvent.NAME]: OrAssetTreeSelectionEvent;
        [OrAssetTreeRequestAddEvent.NAME]: OrAssetTreeRequestAddEvent;
        [OrAssetTreeAddEvent.NAME]: OrAssetTreeAddEvent;
        [OrAssetTreeRequestDeleteEvent.NAME]: OrAssetTreeRequestDeleteEvent;
        [OrAssetTreeAssetEvent.NAME]: OrAssetTreeAssetEvent;
    }
}

export const getAssetTypes = async () => {
    const response = await manager.rest.api.AssetResource.queryAssets({
        select: {
            excludeAttributes: true,
            excludeParentInfo: true,
            excludePath: true
        },
        recursive: true
    });

    if(response && response.data) {
        return response.data.map(asset => asset.type!);
    }
}

export function getDefaultAllowedAddAssetTypes(): AssetDescriptor[] {
    return AssetModelUtil.getAssetDescriptors().filter(ad => ad.name !== WellknownAssets.UNKNOWNASSET);
}

@customElement("or-asset-tree")
export class OrAssetTree extends subscribe(manager)(LitElement) {

    static get styles() {
        return [
            style
        ];
    }

    /**
     * Allows arbitrary assets to be displayed using a tree
     */
    @property({type: Array, reflect: false})
    public assets?: Asset[];

    @property({type: Object})
    public assetInfos?: AssetTypeInfo[];

    @property({type: Array})
    public _assetIdsOverride?: string[];

    @property({type: Array})
    public _assetTypeOptions?: string[];

    @property({type: Array})
    public rootAssets?: Asset[];

    @property({type: Array})
    public rootAssetIds?: string[];

    @property({type: Boolean})
    public readonly: boolean = false;

    @property({type: Boolean})
    public disabled: boolean = false;

    @property({type: Boolean})
    public disableSubscribe: boolean = false;

    @property({type: Array})
    public selectedIds?: string[];

    @property({type: Boolean})
    public showDeselectBtn?: boolean = true;

    @property({type: Boolean})
    public showSortBtn?: boolean = true;

    @property({type: String})
    public sortBy?: string = "name";

    @property({type: Boolean})
    public expandNodes?: boolean = false;

    @property({type: Boolean})
    public checkboxes?: boolean = false;

    protected config?: AssetTreeConfig;

    @property({attribute: false})
    protected _nodes?: UiAssetTreeNode[];

    protected _loading: boolean = false;
    protected _connected: boolean = false;
    protected _selectedNodes: UiAssetTreeNode[] = [];
    protected _expandedNodes: UiAssetTreeNode[] = [];
    protected _initCallback?: EventCallback;

    @state()
    protected _filter: OrAssetTreeFilter = new OrAssetTreeFilter();
    protected _searchInputTimer?: number = undefined;
    @query("#clearIcon")
    protected _clearIcon!: HTMLElement;
    @query("#filterInput")
    protected _filterInput!: OrMwcInput;
    @query("#asset-tree-filter-setting")
    protected _filterSetting!: HTMLElement;
    @state()
    protected _assetTypes: AssetDescriptor[] = [];
    @query("#attributeNameFilter")
    protected _attributeNameFilter!: OrMwcInput;
    @query("#attributeValueFilter")
    protected _attributeValueFilter!: OrMwcInput;
    @query("#assetTypeFilter")
    protected _assetTypeFilter!: OrMwcInput;
    // @state()
    // protected _filterOptions: { assetType: AssetDescriptor | undefined } = { assetType: undefined };

    public get selectedNodes(): UiAssetTreeNode[] {
        return this._selectedNodes ? [...this._selectedNodes] : [];
    }

    public set selectedNodes(nodes: UiAssetTreeNode[]) {
        this.selectedIds = nodes.map((node) => node.asset!.id!);
    }

    public connectedCallback() {
        super.connectedCallback();
    }

    public disconnectedCallback() {
        super.disconnectedCallback();
        this.requestUpdate();
    }

    public refresh() {
        // Clear nodes to re-fetch them
        this._nodes = undefined;
    }

    public isAncestorSelected(node: UiAssetTreeNode) {
        if (!this.selectedIds || !node.parent) {
            return false;
        }

        while (node.parent) {
            node = node.parent;
            if (this.selectedIds.includes(node.asset!.id!)) {
                return true;
            }
        }
        return false;
    }

    protected mapDescriptors(descriptors: (AssetDescriptor)[]): ListItem[] {
        return descriptors.map((descriptor) => {
            return {
                styleMap: {
                    "--or-icon-fill": descriptor.colour ? "#" + descriptor.colour : "unset"
                },
                icon: descriptor.icon,
                text: Util.getAssetTypeLabel(descriptor),
                value: descriptor.name!,
                data: descriptor
            }
        }).sort(Util.sortByString((listItem) => listItem.text));
    }

    protected assetTypeSelect(): TemplateResult {
        console.log('render menu... : ' + this._filter.assetType);
        if (this._filter.assetType) {
            const descriptor: AssetDescriptor | undefined = this._assetTypes.find((at: AssetDescriptor) => { return at.name === this._filter.assetType });
            if (descriptor) {
                console.log('found descriptor...');
                const assetTypeLabel: string = Util.getAssetTypeLabel(descriptor);
                return html `<div class="filterAssetType">
                <or-icon style="color: #${descriptor.colour}" icon="${ descriptor.icon }"></or-icon>
                <span>${assetTypeLabel}</span>
            </div>`;
            } else {
                return html `<or-mwc-input .label="${i18next.t("filter.assetTypeLabel")}" comfortable="true" .type="${InputType.BUTTON}" style="margin-bottom: 14px;"></or-mwc-input>`;
            }
        } else {
            return html `<or-mwc-input .label="${i18next.t("filter.assetTypeLabel")}" comfortable="true" .type="${InputType.BUTTON}" style="margin-bottom: 14px;"></or-mwc-input>`;
        }
    }

    protected render() {
        return html`
            <div id="header">
                <div id="title-container">
                    <or-translate id="title" value="asset_plural"></or-translate>
                </div>

                <div id="header-btns">
                    <or-mwc-input ?hidden="${!this.selectedIds || this.selectedIds.length === 0 || !this.showDeselectBtn}" type="${InputType.BUTTON}" icon="close" @click="${() => this._onDeselectClicked()}"></or-mwc-input>
                    <or-mwc-input ?hidden="${this._isReadonly() || !this.selectedIds || this.selectedIds.length !== 1}" type="${InputType.BUTTON}" icon="content-copy" @click="${() => this._onCopyClicked()}"></or-mwc-input>
                    <or-mwc-input ?hidden="${this._isReadonly() || !this.selectedIds || this.selectedIds.length === 0 || this.selectedNodes.some((node) => this.isAncestorSelected(node))}" type="${InputType.BUTTON}" icon="delete" @click="${() => this._onDeleteClicked()}"></or-mwc-input>
                    <or-mwc-input ?hidden="${this._isReadonly() || !this._canAdd()}" type="${InputType.BUTTON}" icon="plus" @click="${() => this._onAddClicked()}"></or-mwc-input>
                    <or-mwc-input hidden type="${InputType.BUTTON}" icon="magnify" @click="${() => this._onSearchClicked()}"></or-mwc-input>
                    
                    ${getContentWithMenuTemplate(
                            html`<or-mwc-input type="${InputType.BUTTON}" ?hidden="${!this.showSortBtn}" icon="sort-variant"></or-mwc-input>`,
                            ["name", "type", "createdOn", "status"].map((sort) => { return {value: sort, text: i18next.t(sort)} as ListItem; }),
                            this.sortBy,
                            (v) => this._onSortClicked(v as string))}
                </div>
            </div>
            
            <div id="asset-tree-filter">
                <or-mwc-input id="filterInput"
                              ?disabled="${this._loading}"
                              style="width: 100%;"
                              type="${ InputType.TEXT }"
                              icon="magnify" 
                              compact="true"
                              outlined="true"
                              @input="${(e: KeyboardEvent) => {
                                  // Means some input is occurring so delay filter
                                  this._onFilterInputEven(e);                                  
                              }}"
                              @or-mwc-input-changed="${ (e: OrInputChangedEvent) => {
                                  // Means field has lost focus so do filter immediately
                                  // this._doFiltering(FilterElementType.SEARCH_FILTER, (e.detail.value as string) || undefined);
                                  this._onFilterInput((e.detail.value as string) || undefined, true);
                              }}">
                              </or-mwc-input>
                <or-icon id="clearIcon" icon="close" @click="${() => {
                    // Wipe the current value and hide the clear button
                    this._filterInput.value = undefined;
                    this._clearIcon.classList.remove("visible");
                    
                    this._attributeValueFilter.value = undefined;
                    this._attributeNameFilter.value = undefined;
                    
                    this._filter = new OrAssetTreeFilter();
                    
                    // Call filtering
                    this._doFiltering();
                }}"></or-icon>
                <or-icon id="filterSettingsIcon" icon="tune" @click="${() => {
                    console.log('show setting...');
                    if ( this._filterSetting.classList.contains("visible") ) {
                        this._filterSetting.classList.remove("visible");
                    } else {
                        this._filterSetting.classList.add("visible");
                        // Avoid to build again the types
                        if ( this._assetTypes.length === 0 ) {
                            const types = this._getAllowedChildTypes(this._selectedNodes[0]);
                            this._assetTypes = types.filter((t) => t.descriptorType === "asset");
                        }
                    }
                }}"></or-icon>
            </div>
            <div id="asset-tree-filter-setting">
                <div class="advanced-filter">
                    ${this._assetTypes.length > 0 ? getContentWithMenuTemplate(
                        this.assetTypeSelect(), 
                        this.mapDescriptors(this._assetTypes),
                        undefined,
                        (v: string[] | string) => {
                            console.log('selected ' + (v as string));
                            let newFilter: OrAssetTreeFilter = Object.assign({}, this._filter);
                            newFilter.assetType = (v as string);
                            this._filter = newFilter;
                        }) : html ``
                    }
                    <or-mwc-input id="attributeNameFilter" .label="${i18next.t("filter.attributeLabel")}"
                                  comfortable="true"
                                  .type="${InputType.TEXT}"
                                  style="margin-bottom: 14px;"
                                  ?disabled="${this._loading}"
                                  @input="${(e: KeyboardEvent) => {
                                      // Means some input is occurring so delay filter
                                      this._updateFilterSettingValueFromEvent(e, FilterElementType.ATTRIBUTE_NAME);
                                  }}"
                                  @or-mwc-input-changed="${ (e: OrInputChangedEvent) => {
                                      // Means field has lost focus so do filter immediately
                                      // this._doFiltering(FilterElementType.ATTRIBUTE_NAME, (e.detail.value as string) || undefined);
                                      this._updateFilterSettingValue((e.detail.value as string) || undefined, FilterElementType.ATTRIBUTE_NAME);
                                  }}"></or-mwc-input>
                    <or-mwc-input id="attributeValueFilter" .label="${i18next.t("filter.attributeValueLabel")}"
                                  comfortable="true"
                                  .type="${InputType.TEXT}"
                                  style="margin-bottom: 14px;"
                                  @input="${(e: KeyboardEvent) => {
                                      // Means some input is occurring so delay filter
                                      this._updateFilterSettingValueFromEvent(e, FilterElementType.ATTRIBUTE_VALUE);
                                  }}"
                                  @or-mwc-input-changed="${ (e: OrInputChangedEvent) => {
                                      // Means field has lost focus so do filter immediately
                                      // this._doFiltering(FilterElementType.ATTRIBUTE_VALUE, (e.detail.value as string) || undefined);
                                      this._updateFilterSettingValue((e.detail.value as string) || undefined, FilterElementType.ATTRIBUTE_VALUE);
                                  }}" 
                                  disabled></or-mwc-input>
                    <div>
                        <or-mwc-input style="float: right;" type="${ InputType.BUTTON }" .label="${i18next.t("filter.action")}" raised @click="${() => {
                            this._filterFromSettings();
                        }}"></or-mwc-input>
                    </div>
                </div>
            </div>
            
            ${!this._nodes
                ? html`
                    <span id="loading"><or-translate value="loading"></or-translate></span>`
                : (this._nodes.length === 0
                            ? html `<span id="noAssetsFound"><or-translate value="noAssetsFound"></or-translate></span>` 
                            : html`
                    <div id="list-container">
                        <ol id="list">
                            ${this._nodes.map((treeNode) => this._treeNodeTemplate(treeNode, 0)).filter(t => !!t)}
                        </ol>
                    </div>
                `)
            }

            <div id="footer">
            
            </div>
        `;
    }

    protected _isReadonly() {
        return this.readonly || !manager.hasRole(ClientRole.WRITE_ASSETS);
    }

    protected shouldUpdate(_changedProperties: PropertyValues): boolean {
        const result = super.shouldUpdate(_changedProperties);
        if (_changedProperties.has("assets")
            || _changedProperties.has("rootAssets")
            || _changedProperties.has("rootAssetIds")) {
            this._nodes = undefined;
        }

        if (!this._nodes) {
            this._loadAssets();
            return true;
        }

        if (_changedProperties.has("selectedIds")) {
            if (!Util.objectsEqual(_changedProperties.get("selectedIds"), this.selectedIds)) {
                this._updateSelectedNodes();
            }
        }

        if (_changedProperties.has("sortBy")) {
            this._updateSort(this._nodes!, this._getSortFunction());
        }

        if (_changedProperties.has("disabledSubscribe")) {
            if (this.disableSubscribe) {
                this._removeEventSubscriptions();
            }
        }

        return result;
    }

    protected _updateSelectedNodes() {
        const actuallySelectedIds: string[] = [];
        const selectedNodes: UiAssetTreeNode[] = [];
        OrAssetTree._forEachNodeRecursive(this._nodes!, (node) => {
            if (this.selectedIds && this.selectedIds.indexOf(node.asset!.id!) >= 0) {
                actuallySelectedIds.push(node.asset!.id!);
                selectedNodes.push(node);
                node.selected = true;

                // Expand every ancestor
                let parent = node.parent;
                while (parent) {
                    parent.expanded = true;
                    parent = parent.parent;
                }
            } else {
                node.selected = false;
            }

            if (this.checkboxes) {
                let parent = node.parent;
                while (parent) {
                    const allChildren: UiAssetTreeNode[] = [];
                    OrAssetTree._forEachNodeRecursive(parent.children, (child) => {
                        allChildren.push(child);
                    });
                    parent.someChildrenSelected = false;
                    parent.allChildrenSelected = false;

                    if (allChildren.every(c => actuallySelectedIds.includes(c.asset!.id!))) {
                        parent.allChildrenSelected = true;
                    } else if (allChildren.some(c => actuallySelectedIds.includes(c.asset!.id!))) {
                        parent.someChildrenSelected = true;
                    }

                    parent = parent.parent;
                }
            }
        });

        this.selectedIds = actuallySelectedIds;
        const oldSelection = this._selectedNodes;
        this._selectedNodes = selectedNodes;
        this.dispatchEvent(new OrAssetTreeSelectionEvent({
            oldNodes: oldSelection,
            newNodes: selectedNodes
        }));
    }

    protected _updateSort(nodes: UiAssetTreeNode[], sortFunction: (a: UiAssetTreeNode, b: UiAssetTreeNode) => number) {
        if (!nodes) {
            return;
        }

        nodes.sort(sortFunction);
        nodes.forEach((node) => this._updateSort(node.children, sortFunction));
    }

    protected _toggleExpander(expander: HTMLElement, node: UiAssetTreeNode | null) {
        if (node && node.expandable) {
            node.expanded = !node.expanded;

            if (node.expanded) {
                this._expandedNodes.push(node);
            } else {
                this._expandedNodes = this._expandedNodes.filter(n => n !== node);
            }

            const elem = expander.parentElement!.parentElement!.parentElement!;
            elem.toggleAttribute("data-expanded");
        }
    }

    protected _onNodeClicked(evt: MouseEvent | null, node: UiAssetTreeNode | null) {
        if (evt && evt.defaultPrevented) {
            return;
        }

        if (evt) {
            evt.preventDefault();
        }

        const isExpander = evt && (evt.target as HTMLElement).className.indexOf("expander") >= 0;
        const isParentCheckbox = evt && (evt.target as OrIcon)?.icon?.includes("checkbox-multiple");

        if (isExpander) {
            this._toggleExpander((evt.target as HTMLElement), node);
        } else {
            let canSelect = true;

            if (node && this.config && this.config.select?.types) {
                canSelect = this.config.select.types.indexOf(node.asset!.type!) >= 0;
            }

            if (!canSelect) {
                return;
            }

            let selectedNodes: UiAssetTreeNode[] = [];

            if (node) {
                const index = this.selectedNodes.indexOf(node);
                let select = true;
                let deselectOthers = true;
                const multiSelect = !this._isReadonly() && (!this.config || !this.config.select || !this.config.select.multiSelect);

                // determine if node was already selected
                if (this.checkboxes || (multiSelect && evt && (evt.ctrlKey || evt.metaKey))) {
                    deselectOthers = false;
                    if (index >= 0 && this.selectedIds && this.selectedIds.length > 1) {
                        select = false;
                    }
                }

                // handle selected state
                if (isParentCheckbox) {
                    selectedNodes = [...this.selectedNodes];

                    const childNodes: UiAssetTreeNode[] = [];
                    OrAssetTree._forEachNodeRecursive(node.children, (childNode) => {
                        childNodes.push(childNode);
                    });

                    // based on multiple-box already selected, remove or add to array of selected nodes
                    selectedNodes = (!node.allChildrenSelected)
                        ? selectedNodes.concat(childNodes)
                        : selectedNodes.filter(n => !childNodes.map(cn => cn.asset!.id).includes(n.asset!.id));

                } else if (deselectOthers) {
                    selectedNodes = [node];
                } else if (select) {
                    if (index < 0) {
                        selectedNodes = [...this.selectedNodes];
                        selectedNodes.push(node);
                    }
                } else if (index >= 0) {
                    selectedNodes = [...this.selectedNodes];
                    selectedNodes.splice(index, 1);
                }
            }

            Util.dispatchCancellableEvent(this, new OrAssetTreeRequestSelectionEvent({
                oldNodes: this.selectedNodes,
                newNodes: selectedNodes
            })).then((detail) => {
                if (detail.allow) {
                    this.selectedNodes = detail.detail.newNodes
                }
            });
        }
    }

    protected _onDeselectClicked() {
        this._onNodeClicked(null, null);
    }

    protected parseFromInputFilter(inputValue?: string): OrAssetTreeFilter {
        let searchValue: string | undefined = this._filterInput.value;
        if (inputValue) {
            searchValue = inputValue;
        }
        let resultingFilter: OrAssetTreeFilter = new OrAssetTreeFilter();

        console.log('parsing search input with : ', searchValue);

        if (searchValue) {
            let asset: string = searchValue;
            let matchingResult: RegExpMatchArray | null = searchValue.match(/(\s|^)(attribute\:)\S+(\s|$)/g);
            if (matchingResult) {
                if (matchingResult.length > 1) {
                    console.log('mmmmh more than one attribute: ');
                    console.log(matchingResult);
                } else {
                    asset = asset.replace(matchingResult[0].toString(), '');
                    console.log('now asset is ' + asset);

                    const startIndex: number = matchingResult[0].toString().indexOf('attribute:');

                    const matchingVal: string = matchingResult[0].toString().substring(startIndex + 'attribute:'.length);
                    console.log('found attribute name : ' + matchingVal);

                    resultingFilter.attribute = matchingVal;
                }
            }

            matchingResult = searchValue.match(/(\s|^)(type\:)\S+(\s|$)/g);
            if (matchingResult) {
                if (matchingResult.length > 1) {
                    console.log('mmmmh more than one type: !');
                    console.log(matchingResult);
                } else {
                    asset = asset.replace(matchingResult[0].toString(), '');

                    const startIndex: number = matchingResult[0].toString().indexOf('type:');

                    const matchingVal: string = matchingResult[0].toString().substring(startIndex + 'type:'.length);
                    console.log('found asset type : ' + matchingVal);

                    resultingFilter.assetType = matchingVal;
                }
            }

            console.log('now 2 asset is ' + asset);

            matchingResult = searchValue.match(/(\s|^)(\"[^\s]+\")\:\S+(\s|$)/g);
            if (matchingResult) {
                if (matchingResult.length > 1) {
                    console.log('mmmmh more than one attribute value: ');
                    console.log(matchingResult);
                } else {
                    asset = asset.replace(matchingResult[0].toString(), '');
                    const matchingVal: string = matchingResult[0].toString();
                    console.log('found attribute value : ' + matchingVal);

                    resultingFilter.attributeValue = matchingVal;
                }
            }

            console.log('now 3 asset is ' + asset);

            resultingFilter.asset = (asset && asset.length > 0) ? asset : undefined;

            console.log('result :');
            console.log(resultingFilter);
        }

        return resultingFilter;
    }

    protected formatFilter(asset: string | undefined): string {
        let searchInput: string = asset ? asset : '';

        let prefix: string = asset ? ' ' : '';

        for (let type in FilterElementType) {
            switch (type) {
                case FilterElementType.ASSET_TYPE.toString():
                    if (this._filter.assetType) {
                        searchInput += prefix + 'type:' + this._filter.assetType;
                        prefix = ' ';
                    }
                    break;
                case FilterElementType.ATTRIBUTE_NAME.toString():
                    if (this._filter.attribute && !this._filter.attributeValue) {
                        searchInput += prefix + 'attribute:' + this._filter.attribute;
                        prefix = ' ';
                    }
                    break;
                case FilterElementType.ATTRIBUTE_VALUE.toString():
                    if (this._filter.attributeValue) {
                        searchInput += prefix + '"' + this._filter.attribute + '":' + this._filter.attributeValue;
                        prefix = ' ';
                    }
                    break;
            }
        }

        return searchInput;
    }

    protected _updateFilterSettingValueFromEvent(e: KeyboardEvent, type: FilterElementType): void {
        let value: string | undefined;

        if (e.composedPath()) {
            value = ((e.composedPath()[0] as HTMLInputElement).value) || undefined;
        }

        this._updateFilterSettingValue(value, type);
    }

    protected _updateFilterSettingValue(value: string | undefined, type: FilterElementType): void {
        switch (type) {
            case FilterElementType.ASSET_TYPE:
                this._filter.assetType = value;
                break;
            case FilterElementType.ATTRIBUTE_NAME:
                this._filter.attribute = value;

                if (value) {
                    this._attributeValueFilter.disabled = false;
                } else {
                    this._attributeValueFilter.disabled = true;
                }

                break;
            case FilterElementType.ATTRIBUTE_VALUE:
                this._filter.attributeValue = value;
                break;
        }
    }

    protected _filterFromSettings(): void {
        console.log('formatInputFilterFromSettings : ' + JSON.stringify(this._filter));

        console.log('clean all other content from input search except asset name');
        let filterFromSearchInput: OrAssetTreeFilter = this.parseFromInputFilter();

        console.log('then set settings to right value and add it to search input');
        let newFilterForSearchInput: string = this.formatFilter(filterFromSearchInput.asset);

        if (newFilterForSearchInput) {
            this._clearIcon.classList.add("visible");
        } else {
            this._clearIcon.classList.remove("visible");
        }

        this._filterInput.value = newFilterForSearchInput;

        console.log('filtering content');
        this._doFiltering();
    }

    protected _onFilterInputEven(e: KeyboardEvent) {
        let value: string | undefined;

        if (e.composedPath()) {
            value = ((e.composedPath()[0] as HTMLInputElement).value) || undefined;

            if (value) {
                this._clearIcon.classList.add("visible");
            } else {
                this._clearIcon.classList.remove("visible");
            }
        }

        this._onFilterInput(value, false);
    }

    protected _onFilterInput(newValue: string | undefined, force: boolean): void {
        console.log('filtering input with ' + newValue + ' with force mode ' + force);

        if (newValue) {
            this._clearIcon.classList.add("visible");
        } else {
            this._clearIcon.classList.remove("visible");
        }

        let currentFilter: OrAssetTreeFilter = this.parseFromInputFilter(newValue);

        if (this._filter.asset === currentFilter.asset &&
            this._filter.assetType === currentFilter.assetType &&
            this._filter.attribute === currentFilter.attribute &&
            this._filter.attributeValue === currentFilter.attributeValue) {
            console.log('no input value change');
            return;
        }

        this._filter = currentFilter;

        if (this._searchInputTimer) {
            clearTimeout(this._searchInputTimer);
        }

        if (!force) {
            this._searchInputTimer = window.setTimeout(() => {
                this._doFiltering();
            }, 1500);
        } else {
            this._doFiltering();
        }

    }

    protected async _doFiltering() {
        // Clear timeout in case we got here from value change
        if (this._searchInputTimer) {
            clearTimeout(this._searchInputTimer);
            this._searchInputTimer = undefined;
        }

        if (this.isConnected && this._nodes) {

            if (!this._filter.asset && !this._filter.attribute && !this._filter.assetType && !this._filter.attributeValue) {
                // Clear the filter
                OrAssetTree._forEachNodeRecursive(this._nodes!, (node) => {
                    node.notMatchingFilter = false;
                    node.hidden = false;
                });
                this.requestUpdate("_nodes");
                return;
            }

            this.disabled = true;

            // Use a matcher function - this can be altered independent of the filtering logic
            // Maybe we should just filter in memory for basic matches like name
            console.log('time to filter...');
            console.log(this._filter);
            if (this._filter.asset || this._filter.assetType || this._filter.attribute) {
                console.log('assetname is there !');

                let queryRequired: boolean = false;

                if (this._filter.attribute) {
                    queryRequired = true;
                }

                this.getMatcher(queryRequired).then((matcher: (asset: Asset) => boolean) => {
                    if (this._nodes) {
                        console.log('filtering');
                        this._nodes.forEach((node: UiAssetTreeNode) => {
                            this.filterTreeNode(node, matcher);
                        });
                        this.disabled = false;
                    }
                });
            }
        }
    }

    protected getMatcher(requireQuery: boolean): Promise<((asset: Asset) => boolean)> {
        if (requireQuery) {
            return this.getMatcherFromQuery();
        } else {
            return this.getSimpleNameMatcher();
        }
    }

    protected async getSimpleNameMatcher(): Promise<((asset: Asset) => boolean)> {
        return (asset) => {
            let match: boolean = true;
            console.log('matcher...');
            console.log(asset);
            console.log(this._filter);
            if (this._filter.asset) {
                match = match && asset.name!.toLowerCase().includes(this._filter.asset.toLowerCase());
                console.log(match);
            }
            if (this._filter.assetType) {
                console.log(asset.type + ' === ' + this._filter.assetType);
                console.log(asset.type === this._filter.assetType);
                match = match && (asset.type!.toLowerCase() === this._filter.assetType.toLowerCase());
                console.log(match);
            }
            return match;
        };
    }

    protected async getMatcherFromQuery(): Promise<((asset: Asset) => boolean)> {
        let assetCond: StringPredicate[] | undefined = undefined;
        let attributeCond: LogicGroup<AttributePredicate> | undefined = undefined;
        let assetTypeCond: string[] | undefined = undefined;

        if (this._filter.asset) {
            assetCond = [{
                predicateType: "string",
                match: AssetQueryMatch.CONTAINS,
                value: this._filter.asset,
                caseSensitive: false
            }];
        }

        if (this._filter.assetType) {
            assetTypeCond = [ this._filter.assetType ];
        }

        if (this._filter.attribute) {
            attributeCond = {
                items: [
                    {
                        name: {
                            predicateType: "string",
                            match: AssetQueryMatch.CONTAINS,
                            value: this._filter.attribute,
                            caseSensitive: false
                        }
                    }
                ]
            }
        }

        const query: AssetQuery = {
            select: {
                excludePath: true,
                excludeAttributes: attributeCond ? false : true,
                excludeParentInfo: true
            },
            names: assetCond,
            types: assetTypeCond,
            attributes: attributeCond
        };

        const response = await manager.rest.api.AssetResource.queryAssets(query);

        const foundAssetIds: string[] = response.data.map((asset: Asset) => asset.id!);

        return (asset) => {
            let attrValueCheck = true;

            if (this._filter.attribute && this._filter.attributeValue && foundAssetIds.includes(asset.id!)) {
                console.log('attribute with value in filtering... need to filter more!');
                let matchingAsset: Asset | undefined = response.data.find((a: Asset) => a.id === asset.id );

                if (matchingAsset && matchingAsset.attributes) {
                    console.log(matchingAsset.attributes);
                    let atLeastOneAttributeMatchValue: boolean = false;
                    Object.keys(matchingAsset.attributes).forEach((key: string) => {
                        let attr: Attribute<any> = matchingAsset!.attributes![key];

                        // attr.value check to avoid to compare with empty/non existing value
                        if (attr.name!.toLowerCase().includes(this._filter.attribute!.toLowerCase()) && attr.value) {
                            console.log(attr.name + ' ' + attr.type + ' ' + attr.value);
                            switch (attr.type!) {
                                case "number":
                                case "positiveNumber":
                                    const resultNumberEval: boolean = eval(attr.value + this._filter.attributeValue);
                                    console.log('!!!number!!!');
                                    console.log(resultNumberEval);
                                    if (resultNumberEval) {
                                        atLeastOneAttributeMatchValue = true;
                                    }
                                    break;
                                case "text":
                                    if (attr.value) {
                                        let unparsedValue: string = this._filter.attributeValue!;
                                        const multicharString: string = '*';

                                        let parsedValue: string = unparsedValue.replace(multicharString, '.*');

                                        let valueFromAttribute: string = attr.value as string;
                                        let answer = valueFromAttribute.match(parsedValue);
                                        console.log('!!!string!!!');
                                        console.log(answer && answer.length > 0);
                                        if (answer && answer.length > 0) {
                                            atLeastOneAttributeMatchValue = true;
                                        }
                                    }
                                    break;
                            }
                        }
                    });

                    attrValueCheck = atLeastOneAttributeMatchValue;
                }
            }

            return foundAssetIds.includes(asset.id!) && attrValueCheck;
        };
    }

    protected filterTreeNode(currentNode: UiAssetTreeNode, matcher: (asset: Asset) => boolean): boolean {
        let nodeOrDescendantMatches = matcher(currentNode.asset!);
        currentNode.notMatchingFilter = !nodeOrDescendantMatches;

        const childOrDescendantMatches = currentNode.children.map((childNode) => {
            return this.filterTreeNode(childNode, matcher);
        });

        nodeOrDescendantMatches = nodeOrDescendantMatches || childOrDescendantMatches.some(m => m);
        currentNode.expanded = nodeOrDescendantMatches && currentNode.children.length > 0;
        currentNode.hidden = !nodeOrDescendantMatches;
        return nodeOrDescendantMatches;
    }

    protected async _onCopyClicked() {
        if (this._selectedNodes.length !== 1) {
            return;
        }

        try {
            // Need to fully load the source asset
            const response = await manager.rest.api.AssetResource.get(this._selectedNodes[0].asset!.id!);
            if (!response.data) {
                throw new Error("API returned an invalid response when retrieving the source asset");
            }
            const asset = JSON.parse(JSON.stringify(response.data)) as Asset;
            asset.name += " copy";
            delete asset.id;
            delete asset.path;
            delete asset.createdOn;
            delete asset.version;

            Util.dispatchCancellableEvent(this, new OrAssetTreeRequestAddEvent(
                {
                    sourceAsset: this._selectedNodes[0].asset!,
                    asset: asset
                })).then((detail) => {
                    if (detail.allow) {
                        this.dispatchEvent(new OrAssetTreeAddEvent(detail.detail));
                    }
            });
        } catch (e) {
            console.error("Failed to copy asset", e);
            showErrorDialog("Failed to copy asset");
        }
    }

    protected _onAddClicked() {

        const types = this._getAllowedChildTypes(this._selectedNodes[0]);
        const agentTypes = types.filter((t) => t.descriptorType === "agent");
        const assetTypes = types.filter((t) => t.descriptorType === "asset");
        const parent = this._selectedNodes && this._selectedNodes.length === 1 ? this._selectedNodes[0].asset : undefined;
        let dialog: OrMwcDialog;

        const onAddChanged = (ev: OrAddChangedEvent) => {
            const nameValid = !!ev.detail.name && ev.detail.name.trim().length > 0 && ev.detail.name.trim().length < 1024;
            const addBtn = dialog.shadowRoot!.getElementById("add-btn") as OrMwcInput;
            addBtn.disabled = !ev.detail.descriptor || !nameValid;
        };

        dialog = showDialog(new OrMwcDialog()
            .setHeading(i18next.t("addAsset"))
            .setContent(html`
                    <or-add-asset-dialog id="add-panel" .config="${this.config}" .agentTypes="${agentTypes}" .assetTypes="${assetTypes}" .parent="${parent}" @or-add-asset-changed="${onAddChanged}"></or-add-asset-dialog>
                `)
            .setActions([
                    {
                        actionName: "cancel",
                        content: i18next.t("cancel")
                    },
                    {
                        actionName: "add",
                        content: html`<or-mwc-input id="add-btn" class="button" .type="${InputType.BUTTON}" label="${i18next.t("add")}" disabled></or-mwc-input>`,
                        action: () => {

                            const addAssetDialog = dialog.shadowRoot!.getElementById("add-panel") as OrAddAssetDialog;
                            const descriptor = addAssetDialog.selectedType;
                            const selectedOptionalAttributes = addAssetDialog.selectedAttributes;
                            const name = addAssetDialog.name.trim();
                            const parent = addAssetDialog.parent;
                            
                            if (!descriptor) {
                                return;
                            }

                            const asset: Asset = {
                                name: name,
                                type: descriptor.name,
                                realm: manager.displayRealm
                            };

                            // Construct attributes
                            const assetTypeInfo = AssetModelUtil.getAssetTypeInfo(descriptor.name!);

                            if (!assetTypeInfo) {
                                return;
                            }

                            if (assetTypeInfo.attributeDescriptors) {
                                asset.attributes = {};
                                assetTypeInfo.attributeDescriptors
                                    .filter((attributeDescriptor) => !attributeDescriptor.optional)
                                    .forEach((attributeDescriptor) => {
                                        asset.attributes![attributeDescriptor.name!] = {
                                            name: attributeDescriptor.name,
                                            type: attributeDescriptor.type,
                                            meta: attributeDescriptor.meta ? {...attributeDescriptor.meta} : undefined
                                        } as Attribute<any>; 
                                    });
                            }

                            if (selectedOptionalAttributes) {
                                selectedOptionalAttributes?.forEach(attribute => {
                                    asset.attributes![attribute.name!] = {
                                        name: attribute.name,
                                        type: attribute.type,
                                        meta: attribute.meta ? {...attribute.meta} : undefined
                                    }
                                });
                            }

                            if (this.selectedIds) {
                                asset.parentId = parent ? parent.id : undefined;
                            }
                            const detail: AddEventDetail = {
                                asset: asset
                            };
                            Util.dispatchCancellableEvent(this, new OrAssetTreeRequestAddEvent(detail))
                                .then((detail) => {
                                    if (detail.allow) {
                                        this.dispatchEvent(new OrAssetTreeAddEvent(detail.detail));
                                    }
                                });
                        }
                    }
                ])
            .setStyles(html`
                    <style>
                        .mdc-dialog__content {
                            padding: 0 !important;
                        }
                    </style>
                `)
            .setDismissAction(null)
        );
    }

    protected _onDeleteClicked() {
        if (this._selectedNodes.length > 0) {
            Util.dispatchCancellableEvent(this, new OrAssetTreeRequestDeleteEvent(this._selectedNodes))
                .then((detail) => {
                    if (detail.allow) {
                        this._doDelete();
                    }
                });
        }
    }

    protected _onSearchClicked() {

    }

    protected _onSortClicked(sortBy: string) {
        this.sortBy = sortBy;
    }

    protected _doDelete() {

        if (!this._selectedNodes || this._selectedNodes.length === 0) {
            return;
        }

        const doDelete = () => {
            this.disabled = true;

            // Get all descendant IDs of selected nodes
            const assetIds: string[] = [];
            OrAssetTree._forEachNodeRecursive(this._selectedNodes, (node) => {
                assetIds.push(node.asset!.id!);
            });

            manager.rest.api.AssetResource.delete({
                assetId: assetIds
            }, {
                paramsSerializer: params => Qs.stringify(params, {arrayFormat: 'repeat'})
            }).then((response) => {
                // Clear nodes to re-fetch them
                this.refresh();
                this.disabled = false;

                if (response.status !== 204) {
                    showErrorDialog(i18next.t("deleteAssetsFailed"));
                }
            }).catch((reason) => {
                this.refresh();
                this.disabled = false;
                showErrorDialog(i18next.t("deleteAssetsFailed"));
            });
        };

        // Confirm deletion request
        showOkCancelDialog(i18next.t("delete"), i18next.t("deleteAssetsConfirm"), i18next.t("delete"))
            .then((ok) => {
                if (ok) {
                    doDelete();
                }
            });
    }

    protected _canAdd(): boolean {
        if (this._selectedNodes && this._selectedNodes.length > 1) {
            return false;
        }
        const selectedNode = this._selectedNodes ? this._selectedNodes[0] : undefined;
        return this._getAllowedChildTypes(selectedNode).length > 0;
    }

    protected _getAllowedChildTypes(selectedNode: UiAssetTreeNode | undefined): AssetDescriptor[] {
        let includedAssetTypes: string[] | undefined;
        let excludedAssetTypes: string[];

        if (this.config && this.config.add) {
            if (this.config.add.typesProvider) {
                const allowedTypes = this.config.add.typesProvider(selectedNode);
                if (allowedTypes) {
                    return allowedTypes;
                }
            }

            if (this.config.add.typesParent) {
                let config: AssetTreeTypeConfig | undefined;

                if (!selectedNode && this.config.add.typesParent.none) {
                    config = this.config.add.typesParent.none;
                } else if (selectedNode && this.config.add.typesParent.assetTypes) {
                    config = this.config.add.typesParent.assetTypes[selectedNode.asset!.type!];
                }

                if (!config) {
                    config = this.config.add.typesParent.default;
                }

                if (config) {
                    includedAssetTypes = config.include;
                    excludedAssetTypes = config.exclude || [];
                }
            }
        }

        return getDefaultAllowedAddAssetTypes()
            .filter((descriptor) => (!includedAssetTypes || includedAssetTypes.some((inc) => Util.stringMatch(inc, descriptor.name!)))
                && (!excludedAssetTypes || !excludedAssetTypes.some((exc) => Util.stringMatch(exc, descriptor.name!))));
    }

    protected _getSortFunction(): (a: UiAssetTreeNode, b: UiAssetTreeNode) => number {
        switch (this.sortBy) {
            case "createdOn":
                return Util.sortByNumber((node: UiAssetTreeNode) => (node.asset as any)![this.sortBy!]);
            default:
                return Util.sortByString((node: UiAssetTreeNode) => (node.asset as any)![this.sortBy!]);
        }
    }

    protected _loadAssets() {

        const sortFunction = this._getSortFunction();

        if (!this.assets) {

            if (!this._connected) {
                return;
            }

            if (this._loading) {
                return;
            }

            this._loading = true;

            const query: AssetQuery = {
                tenant: {
                    realm: manager.displayRealm
                },
                select: { // Just need the basic asset info
                    excludeAttributes: true,
                    excludePath: !manager.isRestrictedUser(),
                    excludeParentInfo: true
                }
            };

            if (this.assetIds) {
                query.ids = this.assetIds;
                query.recursive = true;
            } else if (this.rootAssets) {
                query.ids = this.rootAssets.map((asset) => asset.id!);
                query.recursive = true;
            } else if (this.rootAssetIds) {
                query.ids = this.rootAssetIds;
                query.recursive = true;
            }
            this._sendEventWithReply({
                event: {
                    eventType: "read-assets",
                    assetQuery: query
                }
            })
                .then((ev) => {
                    this._loading = false;
                    this._buildTreeNodes((ev as AssetsEvent).assets!, sortFunction)
                });
        } else {
            this._loading = false;
            this._buildTreeNodes(this.assets, sortFunction);
        }
    }

    /* Subscribe mixin overrides */

    public async _addEventSubscriptions(): Promise<void> {
        if (!this.disableSubscribe) {
            // Subscribe to asset events for all assets in the realm
            this._subscriptionIds = [await manager.getEventProvider()!.subscribeAssetEvents(undefined, false, (event) => this._onEvent(event))];
        }
    }

    public onEventsConnect() {
        this._connected = true;
        this._loadAssets();
    }

    public onEventsDisconnect() {
        this._connected = false;
        this._nodes = undefined;
    }

    public getNodes(): UiAssetTreeNode[] {
        return this._nodes || [];
    }

    public _onEvent(event: SharedEvent) {

        if (event.eventType === "assets") {
            const assetsEvent = event as AssetsEvent;
            this._buildTreeNodes(assetsEvent.assets!, this._getSortFunction());
            return;
        }

        if (event.eventType === "asset" && this._nodes && this._nodes.length > 0) {

            const assetEvent = event as AssetEvent;
            if (assetEvent.cause === AssetEventCause.READ) {
                return;
            }
            if (assetEvent.cause === AssetEventCause.UPDATE
                && !(assetEvent.updatedProperties!.includes("name")
                    || assetEvent.updatedProperties!.includes("parentId"))) {
                return;
            }

            // Extract all assets, update and rebuild tree
            const assets: Asset[] = [];
            if (assetEvent.cause !== AssetEventCause.DELETE) {
                assets.push(assetEvent.asset!);
            }
            OrAssetTree._forEachNodeRecursive(this._nodes, (node) => {
                if (node.asset!.id !== assetEvent.asset!.id) {
                    assets.push(node.asset!);
                }
            });
            this._buildTreeNodes(assets, this._getSortFunction());
            this.dispatchEvent(new OrAssetTreeAssetEvent(assetEvent));
        }
    }

    protected _buildTreeNodes(assets: Asset[], sortFunction: (a: UiAssetTreeNode, b: UiAssetTreeNode) => number) {
        if (!assets || assets.length === 0) {
            this._nodes = [];
        } else {
            if (manager.isRestrictedUser()) {
                // Any assets whose parents aren't accessible need to be re-parented
                assets.forEach(asset => {
                    if (!!asset.parentId && !!asset.path && assets.find(a => a.id === asset.parentId) === undefined) {
                        let reparentId = null;
                        for (let i = 2; i < asset.path!.length; i++) {
                            const ancestorId = asset.path![i];
                            if (assets.find(a => a.id === ancestorId) !== undefined) {
                                reparentId = ancestorId;
                                break;
                            }
                        }
                        (asset as AssetWithReparentId).reparentId = reparentId;
                    }
                });
            }

            let rootAssetIds: string[] | undefined;

            if (this.rootAssetIds) {
                rootAssetIds = this.rootAssetIds;
            } else if (this.rootAssets) {
                rootAssetIds = this.rootAssets.map((ra) => ra.id!);
            }

            let rootAssets: UiAssetTreeNode[];

            if (rootAssetIds) {
                rootAssets = assets.filter((asset: AssetWithReparentId) => rootAssetIds!.indexOf(asset.id!) >= 0 || asset.reparentId === null).map((asset) => {
                    return {
                        asset: asset
                    } as UiAssetTreeNode;
                });
            } else {
                rootAssets = assets.filter((asset: AssetWithReparentId) => !asset.parentId || asset.reparentId === null).map((asset) => {
                    return {
                        asset: asset
                    } as UiAssetTreeNode;
                });
            }

            rootAssets.sort(sortFunction);
            rootAssets.forEach((rootAsset) => this._buildChildTreeNodes(rootAsset, assets, sortFunction));
            this._nodes = rootAssets;
            const newExpanded: UiAssetTreeNode[] = [];
            this._expandedNodes.forEach(expandedNode => {
                OrAssetTree._forEachNodeRecursive(this._nodes!, n => {
                    if (n.asset && expandedNode.asset && n.asset.id === expandedNode.asset.id) {
                        n.expanded = true;
                        newExpanded.push(n);
                    }
                });
            });
            this._expandedNodes = newExpanded;
        }

        if (this.selectedIds && this.selectedIds.length > 0) {
            this._updateSelectedNodes();
        }

        if (this.expandNodes) {
            OrAssetTree._forEachNodeRecursive(this._nodes, (node) => {
                if (node.children && node.children.length > 0) {
                    node.expanded = true;
                }
            });
        }
    }

    protected _buildChildTreeNodes(treeNode: UiAssetTreeNode, assets: AssetWithReparentId[], sortFunction: (a: UiAssetTreeNode, b: UiAssetTreeNode) => number) {
        treeNode.children = assets.filter((asset) => asset.parentId === treeNode.asset!.id || asset.reparentId === treeNode.asset!.id).map((asset) => {
            return {
                asset: asset
            } as UiAssetTreeNode;
        }).sort(sortFunction);

        if (treeNode.children.length > 0) {
            treeNode.expandable = true;
        }

        treeNode.children.forEach((childNode) => {
            childNode.parent = treeNode;
            this._buildChildTreeNodes(childNode, assets, sortFunction);
        });
    }

    protected _treeNodeTemplate(treeNode: UiAssetTreeNode, level: number): TemplateResult | string | undefined {

        const descriptor = AssetModelUtil.getAssetDescriptor(treeNode.asset!.type!);

        let parentCheckboxIcon;
        if (treeNode.allChildrenSelected) {
            parentCheckboxIcon = 'checkbox-multiple-marked';
        } else if (treeNode.someChildrenSelected) {
            parentCheckboxIcon = 'checkbox-multiple-marked-outline';
        } else {
            parentCheckboxIcon = 'checkbox-multiple-blank-outline';
        }

        if (treeNode.hidden) {
            return html``;
        }

        let filterColorForNonMatchingAsset: boolean = false;

        if (treeNode.asset && treeNode.notMatchingFilter) {
            filterColorForNonMatchingAsset = true;
        }

        return html`
            <li ?data-selected="${treeNode.selected}" ?data-expanded="${treeNode.expanded}" @click="${(evt: MouseEvent) => this._onNodeClicked(evt, treeNode)}">
                <div class="node-container" style="padding-left: ${level * 22}px">
                    <div class="node-name">
                        <div class="expander" ?data-expandable="${treeNode.expandable}"></div>
                        ${getAssetDescriptorIconTemplate(descriptor, undefined, undefined, (filterColorForNonMatchingAsset ? '#d3d3d3;' : undefined))}
                        <span style="color: ${filterColorForNonMatchingAsset ? '#d3d3d3;' : ''}">${treeNode.asset!.name}</span>
                        ${this.checkboxes ? html`
                            <span class="mdc-list-item__graphic">
                                ${treeNode.expandable 
                                    ? html`<div class="mdc-checkbox">
                                            <or-icon class="mdc-checkbox--parent" icon="${parentCheckboxIcon}"></or-icon>
                                        </div>`
                                    : ``}
                                <div class="mdc-checkbox">
                                    ${treeNode.selected ? html`<or-icon icon="checkbox-marked"></or-icon>`: html`<or-icon icon="checkbox-blank-outline"></or-icon>`}
                                </div>
                            </span>` 
                        : ``}
                    </div>
                </div>
                <ol>
                    ${!treeNode.children ? `` : treeNode.children.map((childNode) => this._treeNodeTemplate(childNode, level + 1)).filter(t => !!t)}
                </ol>
            </li>
        `;
    }

    protected static _forEachNodeRecursive(nodes: UiAssetTreeNode[], fn: (node: UiAssetTreeNode) => void) {
        if (!nodes) {
            return;
        }

        nodes.forEach((node) => {
            fn(node);
            this._forEachNodeRecursive(node.children, fn);
        });
    }
}
