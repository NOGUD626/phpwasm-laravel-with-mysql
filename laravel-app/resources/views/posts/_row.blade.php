{{-- 1 行分の <tr>。Alpine.js でインライン編集モードを toggle、HTMX で PATCH/DELETE。 --}}
<tr id="post-{{ $post->id }}" x-data="{ edit: false }">
    <td>{{ $post->id }}</td>

    {{-- 表示モード(edit=false) --}}
    <td x-show="!edit">{{ $post->title }}</td>
    <td x-show="!edit">{{ $post->body }}</td>

    {{-- 編集モード(edit=true)— PATCH /posts/{id} で更新し、戻ってきた行 partial で自分自身を置換 --}}
    <td x-show="edit" colspan="2" style="display:none">
        <form hx-patch="posts/{{ $post->id }}"
              hx-target="#post-{{ $post->id }}"
              hx-swap="outerHTML"
              style="display:flex; gap:6px; flex-wrap:wrap">
            <input name="title" value="{{ $post->title }}" required maxlength="255" style="width:200px" />
            <input name="body"  value="{{ $post->body }}"  maxlength="1000" style="flex:1; min-width:160px" />
            <button class="save" type="submit">保存</button>
            <button type="button" @click="edit=false">cancel</button>
        </form>
    </td>

    <td>{{ optional($post->created_at)->format('m-d H:i') }}</td>

    <td class="actions">
        <button type="button" x-show="!edit" @click="edit=true">編集</button>
        <button class="danger"
                x-show="!edit"
                hx-delete="posts/{{ $post->id }}"
                hx-target="#post-{{ $post->id }}"
                hx-swap="outerHTML"
                hx-confirm="削除しますか?">削除</button>
    </td>
</tr>
