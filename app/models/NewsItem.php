<?php
class NewsItem extends Eloquent
{
    public $timestamps = true;
    protected $table = 'news';

    public function pullPosts()
    {
        return NewsItem::All();
    }
}