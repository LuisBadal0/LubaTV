import { NodeType } from "./nodeType";
import { ViewMode } from "./viewMode";
import { pageScroller } from "../page-scroll";
import { Country } from "../countries";

export class Node {
  readonly id: number;
  readonly name: string;
  readonly type: NodeType;
  readonly scrollPosition: number;
  query?: string;
  page?: number;
  fromViewType?: ViewMode;
  /** The country search open when this node was entered, restored on the way back. */
  country?: Country;

  constructor(
    id: number,
    name: string,
    type: NodeType,
    query?: string,
    fromViewType?: ViewMode,
    country?: Country,
  ) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.query = query;
    this.scrollPosition = pageScroller().scrollTop;
    this.fromViewType = fromViewType;
    this.country = country;
  }

  toString(): string {
    return `Viewing: ${this.name}`;
  }
}
